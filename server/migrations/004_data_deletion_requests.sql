-- Solicitações públicas de exclusão de dados. A execução da exclusão é
-- deliberada e auditável: o pedido entra na fila antes de qualquer remoção.

create table if not exists data_deletion_requests (
  id text primary key,
  email text not null,
  name text,
  details text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'rejected')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  resolution_note text
);

create index if not exists data_deletion_requests_pending_requested_idx
  on data_deletion_requests (requested_at asc)
  where status = 'pending';
