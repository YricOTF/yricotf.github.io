begin;

create table dino_private.rank_reviewed_results (
  run uuid primary key references dino_private.runs(id) on delete cascade,
  score integer not null check (score >= 0),
  distance integer not null check (distance >= 0),
  fossils integer not null check (fossils >= 0),
  reviewed_at timestamptz not null default clock_timestamp(),
  note text not null check (char_length(note) between 1 and 320)
);
alter table dino_private.rank_reviewed_results enable row level security;
revoke all on dino_private.rank_reviewed_results from public, anon, authenticated, service_role;

create view dino_private.rank_results with (security_invoker = true) as
  select r.id, r.player, r.finished_at, r.score, r.distance, r.fossils, false as reviewed
  from dino_private.runs r where r.finished_at is not null
  union all
  select r.id, r.player, m.reviewed_at, m.score, m.distance, m.fossils, true
  from dino_private.rank_reviewed_results m join dino_private.runs r on r.id = m.run
  where r.finished_at is null;
revoke all on dino_private.rank_results from public, anon, authenticated, service_role;

create function public.dino_rank_board(p_kind text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with eligible as (
    select * from dino_private.rank_results r
    where not exists (select 1 from dino_private.blocked_players b where b.player = r.player)
  ), best as (
    select distinct on (r.player) r.id, r.player, r.finished_at, r.score, r.distance, r.reviewed
    from eligible r where p_kind = 'score'
    order by r.player, r.score desc, r.distance desc, r.finished_at, r.id
  ), totals as (
    select r.player, sum(r.fossils) as fossils, bool_or(r.reviewed and r.fossils > 0) as reviewed
    from eligible r where p_kind = 'fossils'
    group by r.player having sum(r.fossils) > 0
  ), sorted as (
    (select row_number() over (order by b.score desc, b.distance desc, b.finished_at, b.id) as place,
      b.player, b.score, b.distance, null::bigint as fossils, b.reviewed
    from best b order by place limit 50)
    union all
    (select row_number() over (order by t.fossils desc, t.player) as place,
      t.player, null::integer, null::integer, t.fossils, t.reviewed
    from totals t order by place limit 50)
  )
  select coalesce(jsonb_agg(jsonb_build_object('place', s.place, 'nick', coalesce(p.nick, '访客#' || s.place),
    'score', s.score, 'distance', s.distance, 'fossils', s.fossils, 'reviewed', s.reviewed) order by s.place), '[]'::jsonb)
  from sorted s left join dino_private.profiles p on p.player = s.player;
$$;

create or replace function public.dino_leaderboard() returns table(place bigint, nick text, score integer, distance integer)
language sql stable security definer set search_path = '' as $$
  select * from jsonb_to_recordset(public.dino_rank_board('score'))
    as ranking(place bigint, nick text, score integer, distance integer)
  order by ranking.place;
$$;

create or replace function public.dino_fossil_leaderboard() returns table(place bigint, nick text, fossils bigint)
language sql stable security definer set search_path = '' as $$
  select * from jsonb_to_recordset(public.dino_rank_board('fossils'))
    as ranking(place bigint, nick text, fossils bigint)
  order by ranking.place;
$$;

create or replace function public.dino_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'nick', (select p.nick from dino_private.profiles p where p.player = auth.uid()),
    'rankedFossils', coalesce((
      select sum(r.fossils) from dino_private.rank_results r
      where r.player = auth.uid()
        and not exists (select 1 from dino_private.blocked_players b where b.player = r.player)
    ), 0),
    'walletFossils', (
      select s.totals->'fossils' from dino_private.resource_snapshots s
      where s.player = auth.uid() order by s.id desc limit 1
    )
  );
$$;

create or replace function public.dino_rank_history() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(history) order by history.started_at desc), '[]'::jsonb)
  from (
    select coalesce(r.id, a.run) as id, coalesce(r.started_at, a.started_at) as started_at,
      v.finished_at, v.score, v.distance, v.fossils, coalesce(v.reviewed, false) as reviewed,
      case when v.finished_at is null then coalesce(r.rejection, a.rejection) end as rejection,
      a.status as appeal, a.reply,
      v.finished_at is null and r.validation_attempts < 8 and r.started_at > now() - interval '4 hours' as can_retry
    from (
      select own.* from dino_private.runs own where own.player = auth.uid()
        and (own.finished_at is not null or own.rejection is not null
          or exists (select 1 from dino_private.rank_reviewed_results m where m.run = own.id))
    ) r
    full join (select * from dino_private.rank_appeals where player = auth.uid()) a on a.run = r.id
    left join dino_private.rank_results v on v.id = r.id
    order by coalesce(r.started_at, a.started_at) desc limit 30
  ) history;
$$;

revoke all on function public.dino_rank_board(text) from public, anon, authenticated, service_role;
grant execute on function public.dino_rank_board(text) to anon, authenticated;
revoke all on function public.dino_appeal_run(uuid,text) from public, anon, authenticated, service_role;

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
  delete from dino_private.runs r where player = who and finished_at is null
    and not exists (select 1 from dino_private.rank_reviewed_results m where m.run = r.id) and (
    (rejection is null and started_at < clock_timestamp() - interval '4 hours')
    or started_at < clock_timestamp() - interval '30 days'
  );
  insert into dino_private.runs(player, seed, version)
  values (who, greatest(1, ('x' || left(replace(gen_random_uuid()::text, '-', ''), 8))::bit(32)::bigint), p_version) returning * into entry;
  return jsonb_build_object('id', entry.id, 'seed', entry.seed);
end;
$$;

create function public.dino_appeal_verified(p_player uuid, p_id uuid, p_message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  player_id uuid := p_player;
  match dino_private.runs;
  reviewed dino_private.rank_appeals;
begin
  if player_id is null then raise sqlstate 'PT401'; end if;
  perform pg_advisory_xact_lock(hashtextextended(player_id::text, 74));
  select * into reviewed from dino_private.rank_appeals where run = p_id and player = player_id;
  if found then return jsonb_build_object('status', reviewed.status); end if;
  select * into match from dino_private.runs where id = p_id and player = player_id and rejection is not null
    and finished_at is null and started_at > now() - interval '30 days'
    and not exists (select 1 from dino_private.rank_reviewed_results m where m.run = p_id);
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

create or replace function public.dino_moderator_queue(p_token text, p_state text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(dino_private.can_review(p_token), false) then raise sqlstate 'PT403'; end if;
  if p_state = 'data' then
    return (
      select coalesce(jsonb_agg(to_jsonb(rows) order by rows.started_at desc), '[]'::jsonb)
      from (
        select r.id as run, coalesce(p.nick, '玩家') as nick, r.started_at, r.version, v.score, v.distance, v.fossils,
          r.rejection, v.finished_at, v.reviewed, r.validation_attempts, a.status, proofs.count as checkpoints, proofs.last_tick
        from dino_private.runs r
        left join dino_private.profiles p on p.player = r.player
        left join dino_private.rank_appeals a on a.run = r.id
        left join dino_private.rank_results v on v.id = r.id
        left join lateral (
          select count(*) as count, max(c.tick) as last_tick from dino_private.run_checkpoints c where c.run = r.id
        ) proofs on true
        where v.finished_at is not null or r.rejection is not null
        order by r.started_at desc limit 100
      ) rows
    );
  end if;
  if p_state not in ('pending','approved','rejected','all') or p_state is null then raise sqlstate 'PT400'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc), '[]'::jsonb)
    from (
      select a.run, coalesce(p.nick, '玩家') as nick, a.started_at, a.rejection, a.message, a.status, a.reply, a.created_at,
        r.version, v.score, v.distance, v.fossils, v.finished_at, v.reviewed, r.validation_attempts,
        proofs.count as checkpoints, proofs.last_tick
      from dino_private.rank_appeals a
      left join dino_private.profiles p on p.player = a.player
      left join dino_private.runs r on r.id = a.run
      left join dino_private.rank_results v on v.id = r.id
      left join lateral (
        select count(*) as count, max(c.tick) as last_tick from dino_private.run_checkpoints c where c.run = a.run
      ) proofs on true
      where p_state = 'all' or a.status = p_state
      order by a.created_at desc limit 100
    ) rows
  );
end;
$$;

revoke all on function public.dino_appeal_verified(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.dino_appeal_verified(uuid,uuid,text) to service_role;

commit;
