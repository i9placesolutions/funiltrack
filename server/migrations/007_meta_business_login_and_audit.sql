-- Sessões efêmeras de autorização do Meta Business Login.
-- O state puro nunca é persistido: apenas seu hash. O token temporário fica
-- cifrado e é apagado assim que a conexão é concluída para a empresa.
create table if not exists meta_oauth_sessions (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  initiated_by_user_id text not null references users(id) on delete cascade,
  state_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'exchanging', 'authorized', 'completed', 'failed', 'expired', 'cancelled')),
  access_token_encrypted text,
  error_message text,
  expires_at timestamptz not null,
  authorized_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A tela sempre lê uma sessão do mesmo workspace e do mesmo usuário que
-- iniciou a autorização. Esse índice cobre a verificação sem varrer sessões.
create index if not exists meta_oauth_sessions_company_user_status_idx
  on meta_oauth_sessions (company_id, initiated_by_user_id, status, expires_at desc);

-- Expiração e recuperação de callbacks interrompidos usam somente sessões em
-- andamento; um índice parcial mantém essa manutenção barata.
create index if not exists meta_oauth_sessions_active_expiry_idx
  on meta_oauth_sessions (expires_at)
  where status in ('pending', 'exchanging', 'authorized');
