alter table public.messages
  add column if not exists client_read_at timestamptz;

create or replace function public.client_mark_admin_messages_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  own_client_id uuid;
  changed integer;
begin
  select id into own_client_id
  from public.clients
  where user_id = auth.uid() and is_active = true;

  if own_client_id is null then raise exception 'Not authorized'; end if;

  update public.messages
  set client_read_at = coalesce(client_read_at, now())
  where client_id = own_client_id
    and sender = 'admin'
    and client_read_at is null;
  get diagnostics changed = row_count;
  return changed;
end
$$;

create or replace function public.admin_mark_client_conversation_read(target_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  update public.messages
  set is_read = true, read_at = coalesce(read_at, now())
  where client_id = target_client_id
    and sender = 'client'
    and is_read = false;
  get diagnostics changed = row_count;
  return changed;
end
$$;

create or replace function public.admin_delete_message(target_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  delete from public.messages where id = target_message_id;
  if not found then raise exception 'Message is unavailable'; end if;
  return true;
end
$$;

create or replace function public.client_delete_message(target_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare own_client_id uuid;
begin
  select id into own_client_id
  from public.clients
  where user_id = auth.uid() and is_active = true;
  if own_client_id is null then raise exception 'Not authorized'; end if;

  delete from public.messages
  where id = target_message_id and client_id = own_client_id;
  if not found then raise exception 'Message is unavailable'; end if;
  return true;
end
$$;

create or replace function public.admin_list_chat_messages()
returns table (
  id uuid,
  client_id uuid,
  client_first_name text,
  client_last_name text,
  client_phone text,
  sender text,
  subject text,
  message text,
  is_read boolean,
  read_at timestamptz,
  client_read_at timestamptz,
  archived_at timestamptz,
  parent_message_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  return query
  select message_row.id, message_row.client_id, client_row.first_name,
    client_row.last_name, client_row.phone, message_row.sender,
    message_row.subject, message_row.message, message_row.is_read,
    message_row.read_at, message_row.client_read_at, message_row.archived_at,
    message_row.parent_message_id, message_row.created_at
  from public.messages message_row
  join public.clients client_row on client_row.id = message_row.client_id
  where message_row.archived_at is null
  order by message_row.created_at asc;
end
$$;

revoke all on function public.client_mark_admin_messages_read() from public, anon;
revoke all on function public.admin_mark_client_conversation_read(uuid) from public, anon;
revoke all on function public.admin_delete_message(uuid) from public, anon;
revoke all on function public.client_delete_message(uuid) from public, anon;
revoke all on function public.admin_list_chat_messages() from public, anon;
grant execute on function public.client_mark_admin_messages_read() to authenticated;
grant execute on function public.admin_mark_client_conversation_read(uuid) to authenticated;
grant execute on function public.admin_delete_message(uuid) to authenticated;
grant execute on function public.client_delete_message(uuid) to authenticated;
grant execute on function public.admin_list_chat_messages() to authenticated;
