begin;

create function public.dino_start_run_v6() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ticket jsonb := public.dino_start_run_v3();
begin
  update dino_private.runs set version = 6
    where id = (ticket->>'id')::uuid and player = auth.uid();
  return ticket || jsonb_build_object('version', 6);
end;
$$;

revoke all on function public.dino_start_run_v6() from public, anon, authenticated, service_role;
grant execute on function public.dino_start_run_v6() to authenticated;

commit;
