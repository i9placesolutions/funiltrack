-- Autenticação da aplicação, sessões persistentes e estado da integração UazAPI.

create table if not exists users (
  id text primary key,
  name text not null,
  email text not null,
  password_hash text not null,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists users_email_lower_uidx on users (lower(email));

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on sessions (user_id);
create index if not exists sessions_expires_at_idx on sessions (expires_at);

create table if not exists whatsapp_instances (
  id text primary key,
  provider text not null default 'uazapi',
  name text not null,
  token_encrypted text,
  status text not null default 'disconnected',
  qrcode text,
  paircode text,
  jid text,
  phone text,
  profile_name text,
  profile_pic_url text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists whatsapp_events (
  id text primary key,
  provider text not null default 'uazapi',
  provider_event_id text,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create unique index if not exists whatsapp_events_provider_event_uidx
  on whatsapp_events (provider, provider_event_id)
  where provider_event_id is not null;
create index if not exists whatsapp_events_received_idx on whatsapp_events (received_at desc);
