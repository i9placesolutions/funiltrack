-- FunilTrack SaaS multiempresa.
--
-- A aplicação sempre aplica o company_id no servidor. Os dados históricos
-- existentes pertencem ao workspace inicial da i9Place, preservado nesta
-- migração para que a mudança não misture nem descarte a operação já ativa.

create table if not exists companies (
  id text primary key,
  name text not null,
  slug text not null,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists companies_slug_lower_uidx on companies (lower(slug));

create table if not exists company_members (
  company_id text not null references companies(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index if not exists company_members_user_company_idx on company_members (user_id, company_id);

insert into companies (id, name, slug, onboarding_completed_at)
values ('company_i9place', 'i9Place Marketing', 'i9place-marketing', now())
on conflict (id) do nothing;

-- Usuários já existentes continuam atendendo a empresa que já operavam.
insert into company_members (company_id, user_id, role)
select 'company_i9place', id, role
from users
on conflict (company_id, user_id) do nothing;

alter table campaigns add column if not exists company_id text;
alter table ad_sets add column if not exists company_id text;
alter table ads add column if not exists company_id text;
alter table daily_metrics add column if not exists company_id text;
alter table leads add column if not exists company_id text;
alter table lead_events add column if not exists company_id text;
alter table alerts add column if not exists company_id text;
alter table whatsapp_instances add column if not exists company_id text;
alter table whatsapp_events add column if not exists company_id text;
alter table integration_states add column if not exists company_id text;
alter table meta_conversion_events add column if not exists company_id text;

update campaigns set company_id = 'company_i9place' where company_id is null;
update ad_sets set company_id = 'company_i9place' where company_id is null;
update ads set company_id = 'company_i9place' where company_id is null;
update daily_metrics set company_id = 'company_i9place' where company_id is null;
update leads set company_id = 'company_i9place' where company_id is null;
update lead_events set company_id = 'company_i9place' where company_id is null;
update alerts set company_id = 'company_i9place' where company_id is null;
update whatsapp_instances set company_id = 'company_i9place' where company_id is null;
update whatsapp_events set company_id = 'company_i9place' where company_id is null;
update integration_states set company_id = 'company_i9place' where company_id is null;
update meta_conversion_events set company_id = 'company_i9place' where company_id is null;

alter table campaigns alter column company_id set not null;
alter table ad_sets alter column company_id set not null;
alter table ads alter column company_id set not null;
alter table daily_metrics alter column company_id set not null;
alter table leads alter column company_id set not null;
alter table lead_events alter column company_id set not null;
alter table alerts alter column company_id set not null;
alter table whatsapp_instances alter column company_id set not null;
alter table whatsapp_events alter column company_id set not null;
alter table integration_states alter column company_id set not null;
alter table meta_conversion_events alter column company_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_company_fkey') then
    alter table campaigns add constraint campaigns_company_fkey foreign key (company_id) references companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ad_sets_company_fkey') then
    alter table ad_sets add constraint ad_sets_company_fkey foreign key (company_id) references companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_company_fkey') then
    alter table ads add constraint ads_company_fkey foreign key (company_id) references companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'daily_metrics_company_fkey') then
    alter table daily_metrics add constraint daily_metrics_company_fkey foreign key (company_id) references companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_company_fkey') then
    alter table leads add constraint leads_company_fkey foreign key (company_id) references companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_events_company_fkey') then
    alter table lead_events add constraint lead_events_company_fkey foreign key (company_id) references companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alerts_company_fkey') then
    alter table alerts add constraint alerts_company_fkey foreign key (company_id) references companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_instances_company_fkey') then
    alter table whatsapp_instances add constraint whatsapp_instances_company_fkey foreign key (company_id) references companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_events_company_fkey') then
    alter table whatsapp_events add constraint whatsapp_events_company_fkey foreign key (company_id) references companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'integration_states_company_fkey') then
    alter table integration_states add constraint integration_states_company_fkey foreign key (company_id) references companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meta_conversion_events_company_fkey') then
    alter table meta_conversion_events add constraint meta_conversion_events_company_fkey foreign key (company_id) references companies(id) on delete cascade;
  end if;
end $$;

-- PKs existentes por id continuam compatíveis com os IDs globais da Meta; os
-- índices compostos habilitam integridade e consultas por empresa.
create unique index if not exists campaigns_company_id_id_uidx on campaigns (company_id, id);
create unique index if not exists ad_sets_company_id_id_uidx on ad_sets (company_id, id);
create unique index if not exists ads_company_id_id_uidx on ads (company_id, id);
create unique index if not exists leads_company_id_id_uidx on leads (company_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ad_sets_company_campaign_fkey') then
    alter table ad_sets add constraint ad_sets_company_campaign_fkey
      foreign key (company_id, campaign_id) references campaigns(company_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_company_ad_set_fkey') then
    alter table ads add constraint ads_company_ad_set_fkey
      foreign key (company_id, ad_set_id) references ad_sets(company_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_company_campaign_fkey') then
    alter table ads add constraint ads_company_campaign_fkey
      foreign key (company_id, campaign_id) references campaigns(company_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'daily_metrics_company_campaign_fkey') then
    alter table daily_metrics add constraint daily_metrics_company_campaign_fkey
      foreign key (company_id, campaign_id) references campaigns(company_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_company_campaign_fkey') then
    alter table leads add constraint leads_company_campaign_fkey
      foreign key (company_id, campaign_id) references campaigns(company_id, id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_company_ad_set_fkey') then
    alter table leads add constraint leads_company_ad_set_fkey
      foreign key (company_id, ad_set_id) references ad_sets(company_id, id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_company_ad_fkey') then
    alter table leads add constraint leads_company_ad_fkey
      foreign key (company_id, ad_id) references ads(company_id, id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_events_company_lead_fkey') then
    alter table lead_events add constraint lead_events_company_lead_fkey
      foreign key (company_id, lead_id) references leads(company_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meta_conversion_events_company_lead_fkey') then
    alter table meta_conversion_events add constraint meta_conversion_events_company_lead_fkey
      foreign key (company_id, lead_id) references leads(company_id, id) on delete cascade;
  end if;
end $$;

-- O estado de um provedor é isolado por empresa, não mais global.
do $$
begin
  if exists (
    select 1
      from pg_constraint c
     where c.conname = 'integration_states_pkey'
       and c.conrelid = 'integration_states'::regclass
       and not exists (
         select 1
           from unnest(c.conkey) as key(attnum)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum
          where a.attname = 'company_id'
       )
  ) then
    alter table integration_states drop constraint integration_states_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'integration_states_pkey') then
    alter table integration_states add primary key (company_id, provider);
  end if;
end $$;

alter table meta_conversion_events drop constraint if exists meta_conversion_events_event_id_key;
drop index if exists leads_phone_digits_uidx;
drop index if exists whatsapp_events_provider_event_uidx;

create unique index if not exists meta_conversion_events_company_event_uidx
  on meta_conversion_events (company_id, event_id);
create unique index if not exists leads_company_phone_digits_uidx
  on leads (company_id, phone_digits) where phone_digits <> '';
create unique index if not exists whatsapp_events_company_provider_event_uidx
  on whatsapp_events (company_id, provider, provider_event_id)
  where provider_event_id is not null;
create unique index if not exists whatsapp_instances_company_provider_uidx
  on whatsapp_instances (company_id, provider);

create table if not exists company_integrations (
  company_id text not null references companies(id) on delete cascade,
  provider text not null check (provider in ('meta', 'uazapi')),
  config jsonb not null default '{}'::jsonb,
  secret_encrypted text,
  webhook_secret_hash text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, provider)
);

-- Índices compostos com company_id primeiro: todas as consultas da API usam
-- igualdade do workspace antes dos filtros de tela.
create index if not exists campaigns_company_created_idx on campaigns (company_id, created_at asc, id asc);
create index if not exists ad_sets_company_campaign_idx on ad_sets (company_id, campaign_id);
create index if not exists ads_company_ad_set_idx on ads (company_id, ad_set_id);
create index if not exists ads_company_campaign_idx on ads (company_id, campaign_id);
create index if not exists daily_metrics_company_date_campaign_idx on daily_metrics (company_id, metric_date, campaign_id);
create index if not exists leads_company_campaign_created_idx on leads (company_id, campaign_id, created_at desc);
create index if not exists leads_company_stage_created_idx on leads (company_id, stage, created_at desc);
create index if not exists leads_company_source_idx on leads (company_id, utm_source);
create index if not exists leads_company_name_lower_idx on leads (company_id, lower(name));
create index if not exists lead_events_company_lead_occurred_idx on lead_events (company_id, lead_id, occurred_at);
create index if not exists alerts_company_created_idx on alerts (company_id, created_at desc, id asc);
create index if not exists alerts_company_unread_created_idx on alerts (company_id, created_at desc) where read = false;
create index if not exists whatsapp_events_company_received_idx on whatsapp_events (company_id, received_at desc);
create index if not exists meta_conversion_events_company_pending_idx
  on meta_conversion_events (company_id, status, created_at)
  where status in ('pending', 'failed');
create index if not exists meta_conversion_events_company_lead_idx
  on meta_conversion_events (company_id, lead_id, event_time desc);
