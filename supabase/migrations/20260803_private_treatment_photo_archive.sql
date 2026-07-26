-- Privatna arhiva fotografija tretmana. Idempotentno i bez javnih URL-ova.
begin;

do $preflight$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'clients'
      and column_name = 'id' and udt_name = 'uuid'
  ) then
    raise exception 'Preflight failed: public.clients.id must be uuid';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Preflight failed: public.is_admin() is missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'clients'
      and column_name = 'user_id' and udt_name = 'uuid'
  ) and to_regclass('public.client_accounts') is null then
    raise exception 'Preflight failed: neither clients.user_id nor public.client_accounts can link a client to auth.users';
  end if;
end
$preflight$;

-- Returns the authenticated client's public.clients.id (uuid).
-- The inspected production schema uses clients.user_id; the guarded
-- client_accounts fallbacks keep this helper safe on installations that use
-- a separate auth-account link table.
create or replace function public.current_client_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matched_client_id uuid;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients'
      and column_name = 'user_id' and udt_name = 'uuid'
  ) then
    execute
      'select client.id
         from public.clients client
        where client.user_id = $1
        limit 1'
    into matched_client_id
    using auth.uid();
  end if;

  if matched_client_id is null
    and to_regclass('public.client_accounts') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'client_accounts'
        and column_name = 'client_id' and udt_name = 'uuid'
    )
  then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'client_accounts'
        and column_name = 'user_id' and udt_name = 'uuid'
    ) then
      execute
        'select account.client_id
           from public.client_accounts account
          where account.user_id = $1
          limit 1'
      into matched_client_id
      using auth.uid();
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'client_accounts'
        and column_name = 'auth_user_id' and udt_name = 'uuid'
    ) then
      execute
        'select account.client_id
           from public.client_accounts account
          where account.auth_user_id = $1
          limit 1'
      into matched_client_id
      using auth.uid();
    end if;
  end if;

  return matched_client_id;
end
$$;

revoke all on function public.current_client_id() from public, anon;
grant execute on function public.current_client_id() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-photos', 'client-photos', false, 5242880, array['image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.treatment_photo_sets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  taken_at date not null,
  notes text not null default '',
  visible_to_client boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.treatment_photos (
  id uuid primary key default gen_random_uuid(),
  treatment_id uuid not null references public.treatment_photo_sets(id) on delete cascade,
  phase text not null check (phase in ('before', 'after')),
  image_path text not null unique,
  thumbnail_path text not null unique,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create index if not exists treatment_photo_sets_client_taken_idx
  on public.treatment_photo_sets (client_id, taken_at desc);
create index if not exists treatment_photos_treatment_order_idx
  on public.treatment_photos (treatment_id, phase, sort_order);

alter table public.treatment_photo_sets enable row level security;
alter table public.treatment_photos enable row level security;

drop policy if exists "Admin manages treatment photo sets" on public.treatment_photo_sets;
create policy "Admin manages treatment photo sets"
on public.treatment_photo_sets for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Clients view own visible treatment photo sets" on public.treatment_photo_sets;
create policy "Clients view own visible treatment photo sets"
on public.treatment_photo_sets for select to authenticated
using (client_id = public.current_client_id() and visible_to_client = true);

drop policy if exists "Admin manages treatment photos" on public.treatment_photos;
create policy "Admin manages treatment photos"
on public.treatment_photos for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Clients view photos from own visible treatments" on public.treatment_photos;
create policy "Clients view photos from own visible treatments"
on public.treatment_photos for select to authenticated
using (
  exists (
    select 1 from public.treatment_photo_sets treatment
    where treatment.id = treatment_photos.treatment_id
      and treatment.client_id = public.current_client_id()
      and treatment.visible_to_client = true
  )
);

drop policy if exists "Admin manages private treatment files" on storage.objects;
create policy "Admin manages private treatment files"
on storage.objects for all to authenticated
using (bucket_id = 'client-photos' and public.is_admin())
with check (bucket_id = 'client-photos' and public.is_admin());

drop policy if exists "Clients read own visible treatment files" on storage.objects;
create policy "Clients read own visible treatment files"
on storage.objects for select to authenticated
using (
  bucket_id = 'client-photos'
  and (storage.foldername(name))[1] = public.current_client_id()::text
  and exists (
    select 1
    from public.treatment_photos photo
    join public.treatment_photo_sets treatment on treatment.id = photo.treatment_id
    where treatment.client_id = public.current_client_id()
      and treatment.visible_to_client = true
      and (photo.image_path = objects.name or photo.thumbnail_path = objects.name)
  )
);

revoke all on public.treatment_photo_sets, public.treatment_photos from anon;
grant select on public.treatment_photo_sets, public.treatment_photos to authenticated;
grant insert, update, delete on public.treatment_photo_sets, public.treatment_photos to authenticated;

commit;
