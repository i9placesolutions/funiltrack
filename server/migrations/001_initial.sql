-- FunilTrack - schema inicial persistente.
-- Valores monetários são armazenados em centavos; datas de eventos usam
-- timestamptz para preservar o instante real da conversa.

create table if not exists campaigns (
  id text primary key,
  name text not null,
  status text not null check (status in ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED')),
  objective text not null check (objective in ('LEADS', 'MESSAGES', 'CONVERSIONS', 'TRAFFIC', 'ENGAGEMENT')),
  daily_budget_cents bigint not null default 0 check (daily_budget_cents >= 0),
  spend_cents bigint not null default 0 check (spend_cents >= 0),
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ad_sets (
  id text primary key,
  campaign_id text references campaigns(id) on delete cascade,
  name text not null,
  status text not null check (status in ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED')),
  daily_budget_cents bigint not null default 0 check (daily_budget_cents >= 0),
  spend_cents bigint not null default 0 check (spend_cents >= 0),
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ads (
  id text primary key,
  ad_set_id text references ad_sets(id) on delete cascade,
  campaign_id text references campaigns(id) on delete cascade,
  name text not null,
  status text not null check (status in ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED')),
  spend_cents bigint not null default 0 check (spend_cents >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists daily_metrics (
  campaign_id text not null references campaigns(id) on delete cascade,
  metric_date date not null,
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  spend_cents bigint not null default 0 check (spend_cents >= 0),
  leads bigint not null default 0 check (leads >= 0),
  ctr numeric(8, 4) not null default 0 check (ctr >= 0),
  cpc_cents bigint not null default 0 check (cpc_cents >= 0),
  cpl_cents bigint not null default 0 check (cpl_cents >= 0),
  roas numeric(12, 2) not null default 0 check (roas >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, metric_date)
);

create table if not exists leads (
  id text primary key,
  name text not null,
  phone text not null,
  phone_digits text not null,
  stage text not null default 'novo' check (stage in ('novo', 'contato', 'qualificado', 'vendido', 'perdido')),
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  campaign_id text references campaigns(id) on delete set null,
  ad_set_id text references ad_sets(id) on delete set null,
  ad_id text references ads(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  value_cents bigint not null default 0 check (value_cents >= 0),
  created_by text,
  updated_at timestamptz not null default now()
);

create table if not exists lead_events (
  id text primary key,
  lead_id text not null references leads(id) on delete cascade,
  type text not null check (type in ('lead_criado', 'mensagem_recebida', 'mensagem_enviada', 'estagio_alterado', 'nota')),
  text text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists alerts (
  id text primary key,
  type text not null check (type in ('LEAD_SEM_RESPOSTA', 'ORCAMENTO_ESTOURADO', 'CPL_ACIMA_MEDIA', 'QUEDA_ENTREGA')),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read boolean not null default false,
  ref_id text
);

-- Foreign keys não ganham índice automaticamente no PostgreSQL.
create index if not exists ad_sets_campaign_id_idx on ad_sets (campaign_id);
create index if not exists ads_ad_set_id_idx on ads (ad_set_id);
create index if not exists ads_campaign_id_idx on ads (campaign_id);
create index if not exists daily_metrics_date_campaign_idx on daily_metrics (metric_date, campaign_id);
create index if not exists daily_metrics_campaign_date_idx on daily_metrics (campaign_id, metric_date);
create index if not exists leads_campaign_created_idx on leads (campaign_id, created_at desc);
create index if not exists leads_ad_set_id_idx on leads (ad_set_id);
create index if not exists leads_ad_id_idx on leads (ad_id);
create index if not exists leads_stage_created_idx on leads (stage, created_at desc);
create index if not exists leads_utm_source_idx on leads (utm_source);
create index if not exists lead_events_lead_occurred_idx on lead_events (lead_id, occurred_at);
create index if not exists alerts_created_idx on alerts (created_at desc);
create index if not exists alerts_unread_created_idx on alerts (created_at desc) where read = false;
create unique index if not exists leads_phone_digits_uidx on leads (phone_digits) where phone_digits <> '';

-- Busca textual barata para o volume inicial, sem obrigar a extensão pg_trgm.
create index if not exists leads_name_lower_idx on leads (lower(name));
