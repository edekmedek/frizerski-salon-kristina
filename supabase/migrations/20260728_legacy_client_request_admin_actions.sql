-- Administratorska kompatibilnost za legacy zahtjeve klijenata.
-- Brisanje roditeljskog zahtjeva automatski uklanja isključivo njegove
-- client_request_services retke preko postojećeg ON DELETE CASCADE FK-a.

create or replace function public.admin_delete_client_request(
  target_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_request_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  delete from public.client_requests
  where id = target_request_id
  returning id into deleted_request_id;

  return deleted_request_id is not null;
end
$$;

revoke all on function public.admin_delete_client_request(uuid)
  from public, anon;
grant execute on function public.admin_delete_client_request(uuid)
  to authenticated;
