-- Meta Ads: estado da integração e fila idempotente de eventos de conversão.
-- Tokens de acesso permanecem no ambiente do serviço; não são armazenados no banco.

create table if not exists integration_states (
  provider text primary key,
  status text not null default 'not_configured',
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists meta_conversion_events (
  id text primary key,
  lead_id text not null references leads(id) on delete cascade,
  event_name text not null check (event_name in ('Lead', 'QualifiedLead', 'Purchase')),
  event_id text not null unique,
  event_time timestamptz not null,
  value_cents bigint not null default 0 check (value_cents >= 0),
  currency text not null default 'BRL',
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  sent_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_conversion_events_pending_idx
  on meta_conversion_events (status, created_at)
  where status in ('pending', 'failed');

create index if not exists meta_conversion_events_lead_idx
  on meta_conversion_events (lead_id, event_time desc);

alter table leads add column if not exists attribution jsonb not null default '{}'::jsonb;
