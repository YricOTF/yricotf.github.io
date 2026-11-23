begin;

create table dino_private.profiles (
  player uuid primary key references auth.users(id) on delete cascade,
  nick text not null check (char_length(nick) between 1 and 16),
  nick_key text generated always as (lower(nick)) stored unique
);
alter table dino_private.profiles enable row level security;
revoke all on dino_private.profiles from public, anon, authenticated;

create function dino_private.normal_nick(p_nick text) returns text
language sql immutable strict set search_path = '' as $$
  select btrim(regexp_replace(normalize(p_nick, NFKC), '[[:space:]]+', ' ', 'g'));
$$;

with best as (
  select distinct on (r.player) r.player, r.finished_at,
    dino_private.normal_nick(r.nick) as nick
  from dino_private.runs r where r.finished_at is not null
  order by r.player, r.score desc, r.distance desc, r.finished_at, r.id
), numbered as (
  select best.*, row_number() over (partition by lower(nick) order by finished_at, player) as claim,
    row_number() over (order by player) as alias
  from best
)
insert into dino_private.profiles (player, nick)
select player, case when claim = 1 and char_length(nick) between 1 and 16 and nick ~ '^[[:alnum:] _-]+$'
  and nick ~ '[[:alnum:]]' then nick else '恐龙#' || alias end
from numbered;

create function public.dino_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nick', (select nick from dino_private.profiles where player = auth.uid()));
$$;

create function public.dino_set_nickname(p_nick text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  cleaned text := dino_private.normal_nick(left(p_nick, 128));
begin
  if who is null or cleaned is null or char_length(cleaned) not between 1 and 16
    or cleaned !~ '^[[:alnum:] _-]+$' or cleaned !~ '[[:alnum:]]' then
    raise exception 'Invalid nickname' using errcode = '22023';
  end if;
  insert into dino_private.profiles (player, nick) values (who, cleaned)
  on conflict (player) do update set nick = excluded.nick;
  return jsonb_build_object('nick', cleaned);
exception when unique_violation then
  raise sqlstate 'PT409' using message = 'Nickname already in use';
end;
$$;

create or replace function public.dino_leaderboard() returns table(place bigint, nick text, score integer, distance integer)
language sql stable security definer set search_path = '' as $$
  with best as (
    select distinct on (r.player) r.player, r.id, r.score, r.distance, r.finished_at
    from dino_private.runs r where r.finished_at is not null
    and not exists (select 1 from dino_private.blocked_players b where b.player = r.player)
    order by r.player, r.score desc, r.distance desc, r.finished_at, r.id
  ), ranked as (
    select row_number() over (order by b.score desc, b.distance desc, b.finished_at, b.id) as place,
      p.nick, b.score, b.distance
    from best b left join dino_private.profiles p on p.player = b.player
    order by b.score desc, b.distance desc, b.finished_at, b.id limit 50
  )
  select ranked.place, coalesce(ranked.nick, '访客#' || ranked.place), ranked.score, ranked.distance from ranked;
$$;

create function public.dino_start_run_v3() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ticket jsonb;
begin
  if not exists (select 1 from dino_private.profiles where player = auth.uid()) then
    raise sqlstate 'PT409' using message = 'Account nickname required';
  end if;
  ticket := public.dino_start_run(1);
  update dino_private.runs set version = 3
    where id = (ticket->>'id')::uuid and player = auth.uid();
  return ticket;
end;
$$;

revoke all on function public.dino_profile(), public.dino_set_nickname(text), public.dino_start_run_v3()
  from public, anon, authenticated, service_role;
grant execute on function public.dino_profile(), public.dino_set_nickname(text), public.dino_start_run_v3() to authenticated;

create or replace function public.dino_record_snapshot(p_totals jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  previous dino_private.resource_snapshots;
  counter text;
  value jsonb;
  fragments text[] := array['pale','raptor','horn','stego','club','crest','shadow','dune','fern-rex','ember-raptor','glacier-horn','sun-stego','jade-club','violet-crest','cap','visor','crown','helmet','comet','leaf','scarf','pendant','ruff'];
  boosts text[] := array['magnet','shield','amber','feather','trail','scout','flight','dash'];
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

commit;
