/**
 * Contratos tipados da camada de dados do FunilTrack.
 *
 * Os nomes espelham conceitos da Meta Marketing API (Campaign, AdSet, Ad,
 * métricas diárias) acrescidos da camada de leads/WhatsApp. Todos os valores
 * monetários são inteiros em CENTAVOS de BRL para evitar erro de ponto
 * flutuante; a formatação para exibição fica em `src/lib/format.ts`.
 */

/** Objetivo de campanha (subconjunto da Meta Marketing API). */
export type CampaignObjective =
  | 'LEADS'
  | 'MESSAGES'
  | 'CONVERSIONS'
  | 'TRAFFIC'
  | 'ENGAGEMENT'

/** Status de entrega (espelha `status` da Meta). */
export type EntityStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED'

/** Estágio do funil de um lead. */
export enum LeadStage {
  NOVO = 'novo',
  CONTATO = 'contato',
  QUALIFICADO = 'qualificado',
  VENDIDO = 'vendido',
  PERDIDO = 'perdido',
}

/** Tipo de alerta gerado pelo sistema. */
export enum AlertType {
  LEAD_SEM_RESPOSTA = 'LEAD_SEM_RESPOSTA',
  ORCAMENTO_ESTOURADO = 'ORCAMENTO_ESTOURADO',
  CPL_ACIMA_MEDIA = 'CPL_ACIMA_MEDIA',
  QUEDA_ENTREGA = 'QUEDA_ENTREGA',
}

export type AlertSeverity = 'info' | 'warning' | 'critical'

/** Evento de timeline de um lead (conversa no WhatsApp / origem). */
export type LeadEventType =
  | 'lead_criado'
  | 'mensagem_recebida'
  | 'mensagem_enviada'
  | 'estagio_alterado'
  | 'nota'

export interface LeadEvent {
  id: string
  type: LeadEventType
  /** Texto curto do evento / mensagem. */
  text: string
  /** ISO-8601. */
  at: string
}

/** Campanha (espelha `Campaign` da Meta Marketing API). */
export interface Campaign {
  id: string
  name: string
  status: EntityStatus
  objective: CampaignObjective
  /** Orçamento diário em centavos de BRL. */
  dailyBudget: number
  /** Gasto total acumulado em centavos de BRL. */
  spend: number
  /** ISO-8601 (somente data) de início. */
  startDate: string
  /** ISO-8601 (somente data) de fim, quando houver. */
  endDate?: string
}

/** Conjunto de anúncios. */
export interface AdSet {
  id: string
  campaignId: string
  name: string
  status: EntityStatus
  dailyBudget: number
  spend: number
  startDate: string
  endDate?: string
}

/** Anúncio. */
export interface Ad {
  id: string
  adSetId: string
  campaignId: string
  name: string
  status: EntityStatus
  spend: number
  impressions: number
  clicks: number
}

/** Métrica diária agregada por campanha. Datas em ISO-8601 (YYYY-MM-DD). */
export interface DailyMetric {
  campaignId: string
  date: string
  impressions: number
  clicks: number
  /** Gasto em centavos de BRL. */
  spend: number
  leads: number
  /** Percentual 0–1 (exibir com formatPercent). */
  ctr: number
  /** Custo por clique em centavos de BRL. */
  cpc: number
  /** Custo por lead em centavos de BRL. */
  cpl: number
  /** Retorno sobre gasto (adimensional). */
  roas: number
}

/** Lead capturado (form/WhatsApp) com origem UTM completa. */
export interface Lead {
  id: string
  name: string
  phone: string
  stage: LeadStage
  /** Origem UTM. */
  utmSource: string
  utmMedium: string
  utmCampaign: string
  campaignId: string
  adSetId: string
  adId: string
  /** ISO-8601 de criação do lead. */
  createdAt: string
  /** ISO-8601 da última mensagem (null se nunca houve conversa). */
  lastMessageAt: string | null
  /** Valor estimado/fechado em centavos de BRL. */
  value: number
  timeline: LeadEvent[]
}

/** Alerta exibido na aba Alertas. */
export interface Alert {
  id: string
  type: AlertType
  severity: AlertSeverity
  title: string
  message: string
  /** ISO-8601. */
  createdAt: string
  read: boolean
  /** Quando aplicável, referência ao lead/campanha. */
  refId?: string
}
