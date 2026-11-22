begin;

create schema dino_private;
revoke all on schema dino_private from public, anon, authenticated;

create table dino_private.runs (
  id uuid primary key default gen_random_uuid(),
  player uuid not null references auth.users(id) on delete cascade,
  seed bigint not null check (seed between 1 and 4294967295),
  version integer not null,
  started_at timestamptz not null default clock_timestamp(),
  validation_at timestamptz,
  validation_attempts integer not null default 0,
  rejection text check (rejection in ('timing','replay','checkpoint')),
  finished_at timestamptz,
  nick text,
  score integer check (score >= 0),
  distance integer check (distance >= 0),
  fossils integer check (fossils >= 0),
  ticks integer check (ticks between 1 and 90000)
);

create table dino_private.run_checkpoints (
  run uuid not null references dino_private.runs(id) on delete cascade,
  tick integer not null check (tick between 2000 and 90000),
  move_count integer not null check (move_count between 0 and 24000 and move_count % 2 = 0),
  move_hash text not null check (move_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default clock_timestamp(),
  primary key (run, tick)
);

create table dino_private.blocked_players (
  player uuid primary key references auth.users(id) on delete cascade,
  reason text not null,
  blocked_at timestamptz not null default clock_timestamp()
);

create table dino_private.resource_snapshots (
  id bigint generated always as identity primary key,
  player uuid not null references auth.users(id) on delete cascade,
  reported_at timestamptz not null default clock_timestamp(),
  totals jsonb not null
);

alter table dino_private.runs enable row level security;
alter table dino_private.run_checkpoints enable row level security;
alter table dino_private.blocked_players enable row level security;
alter table dino_private.resource_snapshots enable row level security;
revoke all on all tables in schema dino_private from public, anon, authenticated;
create index dino_runs_player_time on dino_private.runs (player, started_at desc);
create index dino_runs_best on dino_private.runs (player, score desc, distance desc, finished_at, id) where finished_at is not null;
create index dino_snapshots_player_time on dino_private.resource_snapshots (player, id desc);

create function public.dino_start_run(p_version integer) returns jsonb
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
  delete from dino_private.runs where player = who and finished_at is null and started_at < clock_timestamp() - interval '4 hours';
  insert into dino_private.runs(player, seed, version)
  values (who, greatest(1, ('x' || left(replace(gen_random_uuid()::text, '-', ''), 8))::bit(32)::bigint), p_version) returning * into entry;
  return jsonb_build_object('id', entry.id, 'seed', entry.seed);
end;
$$;

create function public.dino_checkpoint(p_id uuid, p_tick integer, p_count integer, p_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  entry dino_private.runs;
  last_point dino_private.run_checkpoints;
  now_at timestamptz := clock_timestamp();
begin
  select * into entry from dino_private.runs where id = p_id and player = auth.uid() for update;
  if not found or entry.finished_at is not null or entry.started_at < now_at - interval '4 hours' then
    raise sqlstate 'PT409' using message = 'Run ticket unavailable';
  end if;
  select * into last_point from dino_private.run_checkpoints where run = p_id order by tick desc limit 1;
  if p_tick = last_point.tick and p_count = last_point.move_count and p_hash = last_point.move_hash then return true; end if;
  if p_tick - coalesce(last_point.tick, 0) not between 1500 and 4500
    or p_tick * interval '10 milliseconds' > now_at - entry.started_at + interval '2 seconds'
    or (p_tick - last_point.tick) * interval '10 milliseconds' > now_at - last_point.received_at + interval '2200 milliseconds'
    or p_count < last_point.move_count then
    raise sqlstate 'PT409' using message = 'Checkpoint is out of sequence';
  end if;
  insert into dino_private.run_checkpoints(run, tick, move_count, move_hash) values (p_id, p_tick, p_count, p_hash);
  return true;
end;
$$;

create function public.dino_record_snapshot(p_totals jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  previous dino_private.resource_snapshots;
  counter text;
  value jsonb;
  fragments text[] := array['pale','raptor','horn','stego','club','crest','shadow','dune','cap','visor','crown','helmet','comet','leaf','scarf','pendant','ruff'];
  boosts text[] := array['magnet','shield','amber','feather','trail','scout'];
begin
  if who is null or jsonb_typeof(p_totals) is distinct from 'object'
    or not (p_totals ?& array['fossils','universal','fragments','boosts','bestScore','bestDistance'])
    or ((p_totals - 'fossils' - 'universal' - 'fragments' - 'boosts' - 'bestScore' - 'bestDistance') <> '{}'::jsonb) then
    raise exception 'Invalid resource snapshot' using errcode = '22023';
  end if;
  foreach counter in array array['fossils','universal','bestScore','bestDistance'] loop
    value := p_totals -> counter;
    if jsonb_typeof(value) <> 'number' or (value #>> '{}') !~ '^[0-9]{1,16}$' then
      raise exception 'Invalid resource counter' using errcode = '22023';
    end if;
  end loop;
  foreach counter in array array['fragments','boosts'] loop
    if jsonb_typeof(p_totals -> counter) is distinct from 'object' then
      raise exception 'Invalid inventory' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_each(p_totals -> counter) j
      where not (j.key = any(case when counter = 'fragments' then fragments else boosts end))
      or jsonb_typeof(j.value) <> 'number' or (j.value #>> '{}') !~ '^[0-9]{1,4}$'
    ) then raise exception 'Invalid inventory item' using errcode = '22023'; end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(who::text, 2));
  select * into previous from dino_private.resource_snapshots where player = who order by id desc limit 1;
  if previous.totals = p_totals then return true; end if;
  if previous.reported_at > clock_timestamp() - interval '2 seconds' then return false; end if;
  insert into dino_private.resource_snapshots(player, totals) values (who, p_totals);
  return true;
end;
$$;

create function public.dino_leaderboard() returns table(place bigint, nick text, score integer, distance integer)
language sql stable security definer set search_path = '' as $$
  with best as (
    select distinct on (r.player) r.id, r.nick, r.score, r.distance, r.finished_at
    from dino_private.runs r where r.finished_at is not null
    and not exists (select 1 from dino_private.blocked_players b where b.player = r.player)
    order by r.player, r.score desc, r.distance desc, r.finished_at, r.id
  )
  select row_number() over (order by b.score desc, b.distance desc, b.finished_at, b.id), b.nick, b.score, b.distance
  from best b order by b.score desc, b.distance desc, b.finished_at, b.id limit 50;
$$;

create function public.dino_run_for_validation(p_id uuid, p_player uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare entry dino_private.runs;
begin
  if exists (select 1 from dino_private.blocked_players where player = p_player) then return jsonb_build_object('blocked', true); end if;
  select * into entry from dino_private.runs where id = p_id and player = p_player for update;
  if not found then return null; end if;
  if entry.finished_at is not null then return to_jsonb(entry); end if;
  if entry.validation_at > clock_timestamp() - interval '4 seconds' then return jsonb_build_object('rate_limited', true); end if;
  if entry.validation_attempts >= 8 then return jsonb_build_object('attempts_exhausted', true); end if;
  update dino_private.runs set validation_at = clock_timestamp(), validation_attempts = validation_attempts + 1 where id = p_id returning * into entry;
  return to_jsonb(entry) || jsonb_build_object('proofs', coalesce((select jsonb_agg(jsonb_build_object('tick', tick, 'move_count', move_count, 'move_hash', move_hash) order by tick)
    from dino_private.run_checkpoints where run = p_id), '[]'::jsonb));
end;
$$;

create function public.dino_record_rejection(p_id uuid, p_player uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$
  update dino_private.runs set rejection = p_reason where id = p_id and player = p_player and finished_at is null;
$$;

create function public.dino_finish_verified(p_id uuid, p_player uuid, p_version integer, p_ticks integer,
  p_nick text, p_score integer, p_distance integer, p_fossils integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  entry dino_private.runs;
  now_at timestamptz := clock_timestamp();
begin
  select * into entry from dino_private.runs where id = p_id and player = p_player for update;
  if not found or entry.version is distinct from p_version then
    raise sqlstate 'PT409' using message = 'Run ticket unavailable';
  end if;
  if exists (select 1 from dino_private.blocked_players where player = p_player) then raise sqlstate 'PT403' using message = 'Ranked access blocked'; end if;
  if entry.finished_at is null then
    if entry.started_at < now_at - interval '4 hours' or p_ticks is null
      or p_ticks * interval '10 milliseconds' > now_at - entry.started_at + interval '2 seconds' then
      raise sqlstate 'PT409' using message = 'Run time outside ticket limit';
    end if;
    update dino_private.runs set finished_at = now_at, score = p_score, distance = p_distance, fossils = p_fossils, ticks = p_ticks, rejection = null,
      nick = coalesce(nullif(left(btrim(regexp_replace(p_nick, '[[:cntrl:]]', '', 'g')), 16), ''), '小恐龙-' || left(entry.player::text, 5))
    where id = entry.id returning * into entry;
  end if;
  return jsonb_build_object('score', entry.score, 'distance', entry.distance, 'fossils', entry.fossils);
end;
$$;

create view dino_private.resource_reconciliation as
select latest.player, latest.reported_at, latest.totals,
  coalesce(verified.fossils_earned, 0) as verified_ranked_fossils_earned,
  coalesce(verified.best_score, 0) as verified_ranked_best_score,
  coalesce(verified.best_distance, 0) as verified_ranked_best_distance
from (select distinct on (player) player, reported_at, totals from dino_private.resource_snapshots order by player, id desc) latest
left join (select player, sum(fossils) fossils_earned, max(score) best_score, max(distance) best_distance
  from dino_private.runs where finished_at is not null group by player) verified on verified.player = latest.player;

revoke all on function public.dino_start_run(integer), public.dino_record_snapshot(jsonb), public.dino_leaderboard(),
  public.dino_checkpoint(uuid, integer, integer, text), public.dino_run_for_validation(uuid, uuid), public.dino_record_rejection(uuid, uuid, text),
  public.dino_finish_verified(uuid, uuid, integer, integer, text, integer, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.dino_start_run(integer), public.dino_record_snapshot(jsonb), public.dino_checkpoint(uuid, integer, integer, text) to authenticated;
grant execute on function public.dino_leaderboard() to anon, authenticated;
grant execute on function public.dino_run_for_validation(uuid, uuid), public.dino_record_rejection(uuid, uuid, text),
  public.dino_finish_verified(uuid, uuid, integer, integer, text, integer, integer, integer) to service_role;

commit;
