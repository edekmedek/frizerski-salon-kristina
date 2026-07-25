-- Separate administrator PIN used only to unlock past calendar dates.
-- Additive migration: does not change client portal credentials or existing data.

create table if not exists public.admin_pin_credentials (
  user_id uuid primary key,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_pin_credentials enable row level security;

revoke all on table public.admin_pin_credentials from public, anon, authenticated;

create or replace function public.admin_pin_is_set()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    return false;
  end if;

  return exists (
    select 1
    from public.admin_pin_credentials
    where user_id = auth.uid()
  );
end
$$;

create or replace function public.admin_set_calendar_pin(
  new_pin text,
  current_pin text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential public.admin_pin_credentials%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    return false;
  end if;

  if new_pin is null or new_pin !~ '^[0-9]{6,12}$' then
    return false;
  end if;

  select *
  into credential
  from public.admin_pin_credentials
  where user_id = auth.uid()
  for update;

  if found then
    if credential.locked_until is not null and credential.locked_until > now() then
      return false;
    end if;

    if current_pin is null
      or current_pin !~ '^[0-9]{6,12}$'
      or credential.pin_hash <> extensions.crypt(current_pin, credential.pin_hash)
    then
      update public.admin_pin_credentials
      set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
          locked_until = case
            when failed_attempts + 1 >= 5 then now() + interval '15 minutes'
            else locked_until
          end,
          updated_at = now()
      where user_id = auth.uid();
      return false;
    end if;

    update public.admin_pin_credentials
    set pin_hash = extensions.crypt(new_pin, extensions.gen_salt('bf', 11)),
        failed_attempts = 0,
        locked_until = null,
        updated_at = now()
    where user_id = auth.uid();
    return true;
  end if;

  insert into public.admin_pin_credentials (user_id, pin_hash)
  values (
    auth.uid(),
    extensions.crypt(new_pin, extensions.gen_salt('bf', 11))
  );
  return true;
end
$$;

create or replace function public.admin_verify_calendar_pin(pin_value text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential public.admin_pin_credentials%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    return false;
  end if;

  select *
  into credential
  from public.admin_pin_credentials
  where user_id = auth.uid()
  for update;

  if not found
    or credential.locked_until is not null and credential.locked_until > now()
  then
    return false;
  end if;

  if pin_value is null
    or pin_value !~ '^[0-9]{6,12}$'
    or credential.pin_hash <> extensions.crypt(pin_value, credential.pin_hash)
  then
    update public.admin_pin_credentials
    set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
        locked_until = case
          when failed_attempts + 1 >= 5 then now() + interval '15 minutes'
          else locked_until
        end,
        updated_at = now()
    where user_id = auth.uid();
    return false;
  end if;

  update public.admin_pin_credentials
  set failed_attempts = 0,
      locked_until = null,
      updated_at = now()
  where user_id = auth.uid();
  return true;
end
$$;

revoke all on function public.admin_pin_is_set() from public;
revoke all on function public.admin_set_calendar_pin(text, text) from public;
revoke all on function public.admin_verify_calendar_pin(text) from public;

grant execute on function public.admin_pin_is_set() to authenticated;
grant execute on function public.admin_set_calendar_pin(text, text) to authenticated;
grant execute on function public.admin_verify_calendar_pin(text) to authenticated;
