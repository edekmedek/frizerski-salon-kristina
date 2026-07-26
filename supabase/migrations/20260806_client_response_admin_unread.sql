-- A client confirmation or request for another proposal updates an existing
-- request row. Mark that update unread for administrators so it behaves like
-- a newly arrived inbox item. Safe to run repeatedly.
begin;

create or replace function public.mark_client_request_response_unread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
    and (
      new.client_reply is distinct from old.client_reply
      or new.status is distinct from old.status
    )
    and exists (
      select 1
      from public.clients client
      where client.id = new.client_id
        and client.user_id = auth.uid()
    )
  then
    new.admin_read_at := null;
  end if;
  return new;
end
$$;

drop trigger if exists client_request_response_admin_unread on public.client_requests;
create trigger client_request_response_admin_unread
before update on public.client_requests
for each row
execute function public.mark_client_request_response_unread();

commit;
