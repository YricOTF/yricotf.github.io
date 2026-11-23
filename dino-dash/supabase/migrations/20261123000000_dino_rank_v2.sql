begin;

create function public.dino_start_run_v2() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ticket jsonb;
begin
  ticket := public.dino_start_run(1);
  update dino_private.runs set version = 2
    where id = (ticket->>'id')::uuid and player = auth.uid();
  return ticket;
end;
$$;

revoke all on function public.dino_start_run_v2() from public, anon, authenticated, service_role;
grant execute on function public.dino_start_run_v2() to authenticated;

commit;
