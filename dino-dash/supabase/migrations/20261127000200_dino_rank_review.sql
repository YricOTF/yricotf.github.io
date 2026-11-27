begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table dino_private.rank_appeals (
  run uuid primary key,
  player uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  rejection text not null,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reply text,
  created_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz
);

create table dino_private.rank_moderator (
  singleton boolean primary key default true check (singleton),
  password_hash text not null
);
create table dino_private.rank_moderator_sessions (
  player uuid primary key references auth.users(id) on delete cascade,
  token_hash bytea not null,
  expires_at timestamptz not null
);
create table dino_private.rank_moderator_attempts (
  id bigint generated always as identity primary key,
  player uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default clock_timestamp()
);
create index dino_rank_appeals_player_time on dino_private.rank_appeals(player, created_at desc);
create index dino_rank_moderator_attempts_time on dino_private.rank_moderator_attempts(attempted_at);

alter table dino_private.rank_appeals enable row level security;
alter table dino_private.rank_moderator enable row level security;
alter table dino_private.rank_moderator_sessions enable row level security;
alter table dino_private.rank_moderator_attempts enable row level security;
revoke all on dino_private.rank_appeals, dino_private.rank_moderator, dino_private.rank_moderator_sessions,
  dino_private.rank_moderator_attempts from public, anon, authenticated;

create or replace function public.dino_start_run(p_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  entry dino_private.runs;
begin
  if who is null or p_version is distinct from 1 then
    raise exception 'Invalid user or replay version' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(who::text, 1));
  if exists (select 1 from dino_private.blocked_players where player = who) then
    raise sqlstate 'PT403' using message = 'Ranked access blocked';
  end if;
  if exists (select 1 from dino_private.runs where player = who and started_at > clock_timestamp() - interval '3 seconds')
    or (select count(*) from dino_private.runs where player = who and started_at > clock_timestamp() - interval '1 hour') >= 45 then
    raise sqlstate 'PT429' using message = 'Run request too soon';
  end if;
  delete from dino_private.runs where player = who and finished_at is null and (
    (rejection is null and started_at < clock_timestamp() - interval '4 hours')
    or started_at < clock_timestamp() - interval '30 days'
  );
  insert into dino_private.runs(player, seed, version)
  values (who, greatest(1, ('x' || left(replace(gen_random_uuid()::text, '-', ''), 8))::bit(32)::bigint), p_version) returning * into entry;
  return jsonb_build_object('id', entry.id, 'seed', entry.seed);
end;
$$;

create function public.dino_rank_history() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(history) order by history.started_at desc), '[]'::jsonb)
  from (
    select coalesce(r.id, a.run) as id, coalesce(r.started_at, a.started_at) as started_at,
      r.finished_at, r.score, r.distance, r.fossils, coalesce(r.rejection, a.rejection) as rejection,
      a.status as appeal, a.reply,
      r.finished_at is null and r.validation_attempts < 8 and r.started_at > now() - interval '4 hours' as can_retry
    from (select * from dino_private.runs where player = auth.uid() and (finished_at is not null or rejection is not null)) r
    full join (select * from dino_private.rank_appeals where player = auth.uid()) a on a.run = r.id
    order by coalesce(r.started_at, a.started_at) desc limit 30
  ) history;
$$;

create function public.dino_appeal_run(p_id uuid, p_message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  player_id uuid := auth.uid();
  match dino_private.runs;
  reviewed dino_private.rank_appeals;
begin
  if player_id is null then raise sqlstate 'PT401'; end if;
  perform pg_advisory_xact_lock(hashtextextended(player_id::text, 74));
  select * into reviewed from dino_private.rank_appeals where run = p_id and player = player_id;
  if found then return jsonb_build_object('status', reviewed.status); end if;
  select * into match from dino_private.runs where id = p_id and player = player_id and rejection is not null
    and finished_at is null and started_at > now() - interval '30 days';
  if not found then raise sqlstate 'PT404' using message = 'Appealable run not found'; end if;
  if p_message is null or char_length(btrim(p_message)) not between 1 and 240 then
    raise sqlstate 'PT400' using message = 'Invalid appeal message';
  end if;
  if (select count(*) from dino_private.rank_appeals where player = player_id and created_at > now() - interval '1 hour') >= 3 then
    raise sqlstate 'PT429' using message = 'Appeal rate limit reached';
  end if;
  insert into dino_private.rank_appeals(run, player, started_at, rejection, message)
  values (match.id, player_id, match.started_at, match.rejection, btrim(p_message));
  return jsonb_build_object('status', 'pending');
end;
$$;

create function public.dino_moderator_login(p_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  player_id uuid := auth.uid();
  verifier text;
  session_token text;
begin
  if player_id is null or p_password is null or octet_length(p_password) not between 1 and 72 then return null; end if;
  select password_hash into verifier from dino_private.rank_moderator where singleton;
  if verifier is null then raise sqlstate 'PT503' using message = 'Moderator password is not configured'; end if;
  perform pg_advisory_xact_lock(27110482);
  delete from dino_private.rank_moderator_attempts where attempted_at <= now() - interval '15 minutes';
  if (select count(*) from dino_private.rank_moderator_attempts where player = player_id) >= 5
    or (select count(*) from dino_private.rank_moderator_attempts where attempted_at > now() - interval '1 minute') >= 24
  then raise sqlstate 'PT429' using message = 'Moderator login rate limit reached'; end if;
  insert into dino_private.rank_moderator_attempts(player) values (player_id);
  if extensions.crypt(p_password, verifier) is distinct from verifier then return null; end if;
  session_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into dino_private.rank_moderator_sessions values
    (player_id, sha256(convert_to(session_token, 'UTF8')), now() + interval '30 minutes')
  on conflict (player) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at;
  return session_token;
end;
$$;

create function dino_private.can_review(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_token ~ '^[0-9a-f]{64}$' and exists (
    select 1 from dino_private.rank_moderator_sessions
    where player = auth.uid() and expires_at > now() and token_hash = sha256(convert_to(p_token, 'UTF8'))
  );
$$;
revoke all on function dino_private.can_review(text) from public, anon, authenticated;

create function public.dino_moderator_queue(p_token text, p_state text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(dino_private.can_review(p_token), false) then raise sqlstate 'PT403'; end if;
  if p_state = 'data' then
    return (
      select coalesce(jsonb_agg(to_jsonb(rows) order by rows.started_at desc), '[]'::jsonb)
      from (
        select r.id as run, coalesce(p.nick, '玩家') as nick, r.started_at, r.version, r.score, r.distance, r.fossils,
          r.rejection, r.finished_at, r.validation_attempts, a.status, proofs.count as checkpoints, proofs.last_tick
        from dino_private.runs r
        left join dino_private.profiles p on p.player = r.player
        left join dino_private.rank_appeals a on a.run = r.id
        left join lateral (
          select count(*) as count, max(c.tick) as last_tick from dino_private.run_checkpoints c where c.run = r.id
        ) proofs on true
        where r.finished_at is not null or r.rejection is not null
        order by r.started_at desc limit 100
      ) rows
    );
  end if;
  if p_state not in ('pending','approved','rejected','all') or p_state is null then raise sqlstate 'PT400'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc), '[]'::jsonb)
    from (
      select a.run, coalesce(p.nick, '玩家') as nick, a.started_at, a.rejection, a.message, a.status, a.reply, a.created_at,
        r.version, r.score, r.distance, r.fossils, r.finished_at, r.validation_attempts,
        proofs.count as checkpoints, proofs.last_tick
      from dino_private.rank_appeals a
      left join dino_private.profiles p on p.player = a.player
      left join dino_private.runs r on r.id = a.run
      left join lateral (
        select count(*) as count, max(c.tick) as last_tick from dino_private.run_checkpoints c where c.run = a.run
      ) proofs on true
      where p_state = 'all' or a.status = p_state
      order by a.created_at desc limit 100
    ) rows
  );
end;
$$;

create function public.dino_moderator_review(p_token text, p_id uuid, p_decision text, p_reply text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  reviewed dino_private.rank_appeals;
begin
  if not coalesce(dino_private.can_review(p_token), false) then raise sqlstate 'PT403'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') or p_reply is null
    or char_length(btrim(p_reply)) not between 1 and 240 then raise sqlstate 'PT400'; end if;
  update dino_private.rank_appeals set status = p_decision, reply = btrim(p_reply), reviewed_at = clock_timestamp()
    where run = p_id and status = 'pending' returning * into reviewed;
  if not found then raise sqlstate 'PT409' using message = 'Appeal already reviewed or missing'; end if;
  if p_decision = 'approved' then
    update dino_private.runs set validation_attempts = greatest(0, validation_attempts - 1)
      where id = p_id and player = reviewed.player and finished_at is null;
  end if;
  return jsonb_build_object('status', reviewed.status);
end;
$$;

create function public.dino_moderator_logout(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from dino_private.rank_moderator_sessions
  where player = auth.uid() and token_hash = sha256(convert_to(p_token, 'UTF8'));
$$;

revoke all on function public.dino_rank_history(), public.dino_appeal_run(uuid,text),
  public.dino_moderator_login(text), public.dino_moderator_queue(text,text),
  public.dino_moderator_review(text,uuid,text,text), public.dino_moderator_logout(text)
from public, anon, authenticated, service_role;
grant execute on function public.dino_rank_history(), public.dino_appeal_run(uuid,text),
  public.dino_moderator_login(text), public.dino_moderator_queue(text,text),
  public.dino_moderator_review(text,uuid,text,text), public.dino_moderator_logout(text)
to authenticated;

commit;
