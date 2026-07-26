alter table public.messages
  add column if not exists deleted_by_admin boolean not null default false,
  add column if not exists deleted_by_client boolean not null default false;

create or replace function public.admin_delete_message(target_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  update public.messages set deleted_by_admin = true where id = target_message_id;
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
  select id into own_client_id from public.clients
  where user_id = auth.uid() and is_active = true;
  if own_client_id is null then raise exception 'Not authorized'; end if;
  update public.messages set deleted_by_client = true
  where id = target_message_id and client_id = own_client_id;
  if not found then raise exception 'Message is unavailable'; end if;
  return true;
end
$$;

create or replace function public.admin_list_chat_messages()
returns table (
  id uuid, client_id uuid, client_first_name text, client_last_name text,
  client_phone text, sender text, subject text, message text, is_read boolean,
  read_at timestamptz, client_read_at timestamptz, archived_at timestamptz,
  parent_message_id uuid, created_at timestamptz
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
  where message_row.archived_at is null and message_row.deleted_by_admin = false
  order by message_row.created_at asc;
end
$$;

revoke all on function public.admin_delete_message(uuid) from public, anon;
revoke all on function public.client_delete_message(uuid) from public, anon;
revoke all on function public.admin_list_chat_messages() from public, anon;
grant execute on function public.admin_delete_message(uuid) to authenticated;
grant execute on function public.client_delete_message(uuid) to authenticated;
grant execute on function public.admin_list_chat_messages() to authenticated;
