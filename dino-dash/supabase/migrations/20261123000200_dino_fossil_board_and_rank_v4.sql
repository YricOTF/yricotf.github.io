begin;

create function public.dino_fossil_leaderboard() returns table(place bigint, nick text, fossils bigint)
language sql stable security definer set search_path = '' as $$
  with totals as (
    select r.player, sum(r.fossils) as fossils
    from dino_private.runs r
    where r.finished_at is not null
      and not exists (select 1 from dino_private.blocked_players b where b.player = r.player)
    group by r.player
    having sum(r.fossils) > 0
  ), ranked as (
    select row_number() over (order by t.fossils desc, t.player) as place,
      p.nick, t.fossils
    from totals t left join dino_private.profiles p on p.player = t.player
    order by t.fossils desc, t.player
    limit 50
  )
  select ranked.place, coalesce(ranked.nick, '访客#' || ranked.place), ranked.fossils
  from ranked order by ranked.place;
$$;

create function public.dino_start_run_v4() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ticket jsonb;
begin
  ticket := public.dino_start_run_v3();
  update dino_private.runs set version = 4
    where id = (ticket->>'id')::uuid and player = auth.uid();
  return ticket;
end;
$$;

revoke all on function public.dino_fossil_leaderboard(), public.dino_start_run_v4()
  from public, anon, authenticated, service_role;
grant execute on function public.dino_fossil_leaderboard() to anon, authenticated;
grant execute on function public.dino_start_run_v4() to authenticated;

create or replace function public.dino_record_snapshot(p_totals jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  previous dino_private.resource_snapshots;
  counter text;
  value jsonb;
  fragments text[] := array['pale','raptor','horn','stego','club','crest','shadow','dune','fern-rex','ember-raptor','glacier-horn','sun-stego','jade-club','violet-crest','cap','visor','crown','helmet','comet','leaf','scarf','pendant','ruff','wing-crest','gem-goggles','sun-hat','bone-mask','fern-cloak','shell-collar','river-band','ore-charm'];
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
