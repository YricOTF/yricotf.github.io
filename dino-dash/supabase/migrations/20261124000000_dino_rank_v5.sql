begin;

create function public.dino_start_run_v5() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ticket jsonb := public.dino_start_run_v3();
begin
  update dino_private.runs set version = 5
    where id = (ticket->>'id')::uuid and player = auth.uid();
  return ticket || jsonb_build_object('version', 5);
end;
$$;

revoke all on function public.dino_start_run_v5() from public, anon, authenticated, service_role;
grant execute on function public.dino_start_run_v5() to authenticated;

create or replace function public.dino_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'nick', (select p.nick from dino_private.profiles p where p.player = auth.uid()),
    'rankedFossils', coalesce((
      select sum(r.fossils) from dino_private.runs r
      where r.player = auth.uid() and r.finished_at is not null
        and not exists (select 1 from dino_private.blocked_players b where b.player = r.player)
    ), 0),
    'walletFossils', (
      select s.totals->'fossils' from dino_private.resource_snapshots s
      where s.player = auth.uid() order by s.id desc limit 1
    )
  );
$$;

commit;
