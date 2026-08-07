/**
 * Rótulos pt-BR e variantes de badge para enums da camada de dados.
 * Mantidos aqui para reuso entre as features sem duplicação.
 */
import type { CampaignObjective, EntityStatus, LeadStage } from '../../lib/api'

export type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'

export const STATUS_LABELS: Record<EntityStatus, string> = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  ARCHIVED: 'Arquivada',
  DELETED: 'Removida',
}

export const STATUS_VARIANTS: Record<EntityStatus, BadgeVariant> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  ARCHIVED: 'neutral',
  DELETED: 'danger',
}

export const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  LEADS: 'Leads',
  MESSAGES: 'Mensagens',
  CONVERSIONS: 'Conversões',
  TRAFFIC: 'Tráfego',
  ENGAGEMENT: 'Engajamento',
}

export const STAGE_LABELS: Record<LeadStage, string> = {
  novo: 'Novo',
  contato: 'Contato',
  qualificado: 'Qualificado',
  vendido: 'Vendido',
  perdido: 'Perdido',
}

export const STAGE_VARIANTS: Record<LeadStage, BadgeVariant> = {
  novo: 'neutral',
  contato: 'primary',
  qualificado: 'warning',
  vendido: 'success',
  perdido: 'danger',
}
