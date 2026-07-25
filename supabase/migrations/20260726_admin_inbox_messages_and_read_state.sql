-- Persistent administrator inbox state for client requests and messages.
-- Existing requests and messages are preserved unchanged.

begin;

do $preflight$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Preflight failed: public.is_admin() is missing';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'client_requests'
  ) or not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'messages'
  ) then
    raise exception 'Preflight failed: inbox tables are missing';
  end if;
end
$preflight$;

alter table public.client_requests
  add column if not exists admin_read_at timestamptz;

alter table public.messages
  add column if not exists subject text not null default 'Poruka klijenta',
  add column if not exists read_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists parent_message_id uuid;

do $message_parent_constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_parent_message_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_parent_message_id_fkey
      foreign key (parent_message_id)
      references public.messages(id)
      on delete set null;
  end if;
end
$message_parent_constraint$;

create index if not exists client_requests_admin_unread_idx
  on public.client_requests (created_at desc)
  where admin_read_at is null and status = 'pending';

create index if not exists messages_admin_inbox_idx
  on public.messages (created_at desc)
  where sender = 'client' and archived_at is null;

create index if not exists messages_parent_message_idx
  on public.messages (parent_message_id, created_at);

create or replace function public.admin_list_client_request_inbox()
returns table (
  id uuid,
  client_id uuid,
  client_first_name text,
  client_last_name text,
  client_phone text,
  kind text,
  service text,
  preferred_dates date[],
  day_period text,
  client_message text,
  status text,
  admin_reply text,
  appointment_id uuid,
  admin_read_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select
    request_row.id,
    request_row.client_id,
    client_row.first_name,
    client_row.last_name,
    client_row.phone,
    request_row.kind,
    request_row.service,
    request_row.preferred_dates,
    request_row.day_period,
    request_row.client_message,
    request_row.status,
    request_row.admin_reply,
    request_row.appointment_id,
    request_row.admin_read_at,
    request_row.created_at,
    request_row.updated_at
  from public.client_requests request_row
  join public.clients client_row
    on client_row.id = request_row.client_id
  order by
    case request_row.status
      when 'pending' then 0
      when 'in_review' then 1
      when 'confirmed' then 2
      else 3
    end,
    request_row.created_at desc;
end
$$;

create or replace function public.admin_open_client_request(target_request_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  opened_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.client_requests
  set admin_read_at = coalesce(admin_read_at, now()),
      updated_at = case when admin_read_at is null then now() else updated_at end
  where id = target_request_id
  returning admin_read_at into opened_at;

  if opened_at is null then
    raise exception 'Request is unavailable';
  end if;
  return opened_at;
end
$$;

create or replace function public.admin_respond_client_request(
  target_request_id uuid,
  next_status text,
  reply_message text
)
returns public.client_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_request public.client_requests;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if next_status not in ('in_review', 'rejected') then
    raise exception 'Unsupported request status';
  end if;
  if nullif(btrim(reply_message), '') is null then
    raise exception 'A reply is required';
  end if;

  update public.client_requests
  set status = next_status,
      admin_reply = btrim(reply_message),
      admin_read_at = coalesce(admin_read_at, now()),
      updated_at = now()
  where id = target_request_id
    and status in ('pending', 'in_review')
  returning *
  into updated_request;

  if updated_request.id is null then
    raise exception 'Request is unavailable';
  end if;
  return updated_request;
end
$$;

-- Extend the already-applied atomic accept function with persistent opened state.
create or replace function public.admin_accept_client_request(
  target_request_id uuid,
  target_starts_at timestamptz,
  target_notes text,
  target_no_charge boolean,
  target_service_ids uuid[],
  target_total_duration integer,
  target_total_price numeric
)
returns table (
  request_id uuid,
  appointment_id uuid,
  request_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_request public.client_requests;
  saved_appointment_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select *
  into locked_request
  from public.client_requests
  where id = target_request_id
  for update;

  if locked_request.id is null then
    raise exception 'Request is unavailable';
  end if;
  if locked_request.status = 'confirmed'
    and locked_request.appointment_id is not null
  then
    return query
    select locked_request.id, locked_request.appointment_id, locked_request.status;
    return;
  end if;
  if locked_request.status not in ('pending', 'in_review') then
    raise exception 'Request cannot be accepted';
  end if;

  saved_appointment_id := public.admin_save_appointment_with_services(
    null,
    locked_request.client_id,
    target_starts_at,
    'confirmed',
    coalesce(target_notes, ''),
    coalesce(target_no_charge, false),
    target_service_ids,
    target_total_duration,
    target_total_price
  );

  update public.client_requests
  set status = 'confirmed',
      appointment_id = saved_appointment_id,
      admin_read_at = coalesce(admin_read_at, now()),
      updated_at = now()
  where id = locked_request.id;

  return query
  select locked_request.id, saved_appointment_id, 'confirmed'::text;
end
$$;

create or replace function public.admin_list_messages(include_archived boolean default false)
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
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select
    message_row.id,
    message_row.client_id,
    client_row.first_name,
    client_row.last_name,
    client_row.phone,
    message_row.sender,
    message_row.subject,
    message_row.message,
    message_row.is_read,
    message_row.read_at,
    message_row.archived_at,
    message_row.parent_message_id,
    message_row.created_at
  from public.messages message_row
  join public.clients client_row
    on client_row.id = message_row.client_id
  where (
    include_archived
    or message_row.archived_at is null
  )
  order by message_row.created_at desc;
end
$$;

create or replace function public.admin_open_message(target_message_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  opened_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.messages
  set is_read = true,
      read_at = coalesce(read_at, now())
  where id = target_message_id
  returning read_at into opened_at;

  if opened_at is null then
    raise exception 'Message is unavailable';
  end if;
  return opened_at;
end
$$;

create or replace function public.admin_reply_to_message(
  target_message_id uuid,
  reply_message text
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_message public.messages;
  saved_reply public.messages;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if nullif(btrim(reply_message), '') is null then
    raise exception 'A reply is required';
  end if;

  select *
  into source_message
  from public.messages
  where id = target_message_id;

  if source_message.id is null then
    raise exception 'Message is unavailable';
  end if;

  insert into public.messages (
    client_id,
    sender,
    subject,
    message,
    is_read,
    read_at,
    parent_message_id
  )
  values (
    source_message.client_id,
    'admin',
    case
      when source_message.subject like 'Re: %' then source_message.subject
      else 'Re: ' || source_message.subject
    end,
    btrim(reply_message),
    true,
    now(),
    source_message.id
  )
  returning *
  into saved_reply;

  return saved_reply;
end
$$;

create or replace function public.admin_archive_message(target_message_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_archived_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.messages
  set archived_at = coalesce(archived_at, now())
  where id = target_message_id
  returning archived_at into saved_archived_at;

  if saved_archived_at is null then
    raise exception 'Message is unavailable';
  end if;
  return saved_archived_at;
end
$$;

create or replace function public.admin_delete_archived_message(target_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  delete from public.messages
  where id = target_message_id
    and archived_at is not null;

  if not found then
    raise exception 'Archived message is unavailable';
  end if;
  return true;
end
$$;

create or replace function public.client_send_message(
  message_subject text,
  message_body text
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  own_client_id uuid;
  saved_message public.messages;
begin
  perform public.salon_require_anonymous_client();

  select client_row.id
  into own_client_id
  from public.clients client_row
  where client_row.user_id = auth.uid()
    and client_row.is_active = true;

  if own_client_id is null then
    raise exception 'Client access could not be verified';
  end if;
  if nullif(btrim(message_body), '') is null then
    raise exception 'A message is required';
  end if;

  insert into public.messages (
    client_id,
    sender,
    subject,
    message,
    is_read
  )
  values (
    own_client_id,
    'client',
    coalesce(nullif(btrim(message_subject), ''), 'Poruka klijenta'),
    btrim(message_body),
    false
  )
  returning *
  into saved_message;

  return saved_message;
end
$$;

-- Keep the existing RLS policies when present and restore only missing policies.
do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'Admins manage messages'
  ) then
    execute $sql$
      create policy "Admins manage messages"
        on public.messages for all to authenticated
        using (public.is_admin()) with check (public.is_admin())
    $sql$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'Clients view own messages'
  ) then
    execute $sql$
      create policy "Clients view own messages"
        on public.messages for select to authenticated
        using (
          exists (
            select 1 from public.clients client_row
            where client_row.id = messages.client_id
              and client_row.user_id = auth.uid()
          )
        )
    $sql$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'Clients send own messages'
  ) then
    execute $sql$
      create policy "Clients send own messages"
        on public.messages for insert to authenticated
        with check (
          sender = 'client'
          and is_read = false
          and read_at is null
          and archived_at is null
          and exists (
            select 1 from public.clients client_row
            where client_row.id = messages.client_id
              and client_row.user_id = auth.uid()
          )
        )
    $sql$;
  end if;
end
$policies$;

revoke all on function public.admin_list_client_request_inbox() from public, anon;
revoke all on function public.admin_open_client_request(uuid) from public, anon;
revoke all on function public.admin_list_messages(boolean) from public, anon;
revoke all on function public.admin_open_message(uuid) from public, anon;
revoke all on function public.admin_reply_to_message(uuid, text) from public, anon;
revoke all on function public.admin_archive_message(uuid) from public, anon;
revoke all on function public.admin_delete_archived_message(uuid) from public, anon;
revoke all on function public.client_send_message(text, text) from public, anon;

grant execute on function public.admin_list_client_request_inbox() to authenticated;
grant execute on function public.admin_open_client_request(uuid) to authenticated;
grant execute on function public.admin_list_messages(boolean) to authenticated;
grant execute on function public.admin_open_message(uuid) to authenticated;
grant execute on function public.admin_reply_to_message(uuid, text) to authenticated;
grant execute on function public.admin_archive_message(uuid) to authenticated;
grant execute on function public.admin_delete_archived_message(uuid) to authenticated;
grant execute on function public.client_send_message(text, text) to authenticated;

commit;

-- Read-only verification: existing TEST messages and pending requests remain present.
select
  'pending_requests' as record_type,
  count(*)::bigint as record_count
from public.client_requests
where status = 'pending'
union all
select
  'test_messages',
  count(*)::bigint
from public.messages message_row
join public.clients client_row on client_row.id = message_row.client_id
where client_row.first_name like 'TEST %'
   or client_row.notes like '[TEST]%';
