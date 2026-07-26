create table if not exists public.client_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_push_subscriptions enable row level security;
revoke all on public.client_push_subscriptions from public, anon, authenticated;

create or replace function public.client_save_push_subscription(
  push_endpoint text,
  push_p256dh text,
  push_auth text,
  push_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  own_client_id uuid;
  saved_id uuid;
begin
  select client_row.id into own_client_id
  from public.clients client_row
  where client_row.user_id = auth.uid()
    and client_row.is_active = true;

  if own_client_id is null then
    raise exception 'Client access could not be verified';
  end if;

  insert into public.client_push_subscriptions (
    client_id, endpoint, p256dh, auth, user_agent
  )
  values (
    own_client_id, push_endpoint, push_p256dh, push_auth, push_user_agent
  )
  on conflict (endpoint) do update
    set client_id = excluded.client_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        updated_at = now()
  returning id into saved_id;

  return saved_id;
end
$$;

revoke all on function public.client_save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.client_save_push_subscription(text, text, text, text) to authenticated;

create index if not exists client_push_subscriptions_client_idx
  on public.client_push_subscriptions (client_id);
