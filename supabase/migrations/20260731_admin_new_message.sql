create or replace function public.admin_send_message(
  target_client_id uuid,
  message_body text
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare saved_message public.messages;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if nullif(btrim(message_body), '') is null then raise exception 'A message is required'; end if;
  if not exists (select 1 from public.clients where id = target_client_id) then raise exception 'Client is unavailable'; end if;

  insert into public.messages (client_id, sender, subject, message, is_read, read_at)
  values (target_client_id, 'admin', 'Poruka salona', btrim(message_body), true, now())
  returning * into saved_message;
  return saved_message;
end
$$;

revoke all on function public.admin_send_message(uuid, text) from public, anon;
grant execute on function public.admin_send_message(uuid, text) to authenticated;
