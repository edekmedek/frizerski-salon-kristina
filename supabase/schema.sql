-- Future Supabase schema. Not executed by the local/demo application.
-- No service-role keys or other secrets belong in the frontend.

create type public.app_role as enum ('administrator', 'client');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id text unique,
  role public.app_role not null default 'client',
  created_at timestamptz not null default now()
);

create table public.client_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  kind text not null,
  service text not null,
  preferred_dates date[] not null default '{}',
  day_period text not null,
  message text not null default '',
  status text not null default 'novo',
  admin_reply text not null default '',
  appointment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id text primary key,
  client_id text not null,
  starts_at timestamptz not null,
  service text not null,
  status text not null,
  note text not null default ''
);

create table public.client_notifications (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  appointment_id text,
  kind text not null,
  title text not null,
  body text not null,
  scheduled_for timestamptz not null,
  status text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.client_requests enable row level security;
alter table public.appointments enable row level security;
alter table public.client_notifications enable row level security;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'administrator'
  );
$$;

create function public.current_client_id() returns text
language sql stable security definer set search_path = ''
as $$
  select client_id from public.profiles where user_id = auth.uid();
$$;

create policy "profiles own or admin" on public.profiles
for select using (user_id = auth.uid() or public.is_admin());

create policy "clients read own requests" on public.client_requests
for select using (client_id = public.current_client_id() or public.is_admin());
create policy "clients create own requests" on public.client_requests
for insert with check (client_id = public.current_client_id());
create policy "admin manages requests" on public.client_requests
for all using (public.is_admin()) with check (public.is_admin());

create policy "clients read own appointments" on public.appointments
for select using (client_id = public.current_client_id() or public.is_admin());
create policy "only admin changes appointments" on public.appointments
for all using (public.is_admin()) with check (public.is_admin());

create policy "clients read own notifications" on public.client_notifications
for select using (client_id = public.current_client_id() or public.is_admin());
create policy "only admin changes notifications" on public.client_notifications
for all using (public.is_admin()) with check (public.is_admin());

-- Keep the client-photos bucket private. The object name should begin with client_id/.
insert into storage.buckets (id, name, public)
values ('client-photos', 'client-photos', false)
on conflict (id) do update set public = false;

create policy "clients read only own photos" on storage.objects
for select to authenticated
using (
  bucket_id = 'client-photos'
  and (
    (storage.foldername(name))[1] = public.current_client_id()
    or public.is_admin()
  )
);

create policy "only admin writes client photos" on storage.objects
for all to authenticated
using (bucket_id = 'client-photos' and public.is_admin())
with check (bucket_id = 'client-photos' and public.is_admin());
