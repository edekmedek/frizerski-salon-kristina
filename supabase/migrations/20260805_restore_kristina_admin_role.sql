-- Recreated Auth users receive a new UUID. Restore only Kristina's confirmed
-- account to the existing administrator role without touching any other user.
begin;

do $restore_kristina_admin$
declare
  matched_count integer;
  target_user_id uuid;
  target_confirmed_at timestamptz;
begin
  select count(*), min(id::text)::uuid, min(email_confirmed_at)
  into matched_count, target_user_id, target_confirmed_at
  from auth.users
  where lower(btrim(email)) = lower('kristinajalusic@gmail.com');

  if matched_count = 0 then
    raise exception 'Kristina auth user does not exist';
  end if;
  if matched_count > 1 then
    raise exception 'More than one Kristina auth user exists; no role was changed';
  end if;
  if target_confirmed_at is null then
    raise exception 'Kristina auth user exists but is not email-confirmed';
  end if;

  insert into public.user_roles (user_id, role)
  values (target_user_id, 'admin')
  on conflict (user_id) do update
  set role = excluded.role;
end
$restore_kristina_admin$;

commit;
