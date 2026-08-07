/**
 * Metas/thresholds de alerta configuráveis pelo usuário.
 *
 * Persistidos em localStorage (fora do AppContext, que é imutável por
 * contrato desta fase). Alimentados pelo onboarding (passo "Definir metas")
 * e editáveis em Config — o motor de regras de `src/lib/alerts/rules.ts`
 * lê estes valores para decidir quando alertar.
 *
 * Convenção monetária: centavos de BRL (mesma regra da camada de dados).
 */

export interface AlertTargets {
  /** CPL alvo em centavos de BRL (alerta quando o CPL real ultrapassa). */
  cplTargetCents: number
  /** Orçamento diário de referência em centavos de BRL. */
  dailyBudgetCents: number
  /** Fração do orçamento diário considerada limite (ex.: 0.8 = 80%). */
  budgetThreshold: number
}

export const DEFAULT_ALERT_TARGETS: AlertTargets = {
  cplTargetCents: 3500, // R$ 35,00
  dailyBudgetCents: 8000, // R$ 80,00
  budgetThreshold: 0.8,
}

const STORAGE_KEY = 'funiltrack:alert-targets'
const LEGACY_STORAGE_KEY = 'metatrack:alert-targets'

/** Lê as metas persistidas (com fallback seguro para os defaults). */
export function loadAlertTargets(): AlertTargets {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_ALERT_TARGETS }
    const parsed = JSON.parse(raw) as Partial<AlertTargets>
    return {
      cplTargetCents: positiveInt(parsed.cplTargetCents)
        ? parsed.cplTargetCents!
        : DEFAULT_ALERT_TARGETS.cplTargetCents,
      dailyBudgetCents: positiveInt(parsed.dailyBudgetCents)
        ? parsed.dailyBudgetCents!
        : DEFAULT_ALERT_TARGETS.dailyBudgetCents,
      budgetThreshold:
        typeof parsed.budgetThreshold === 'number' &&
        parsed.budgetThreshold > 0 &&
        parsed.budgetThreshold <= 1
          ? parsed.budgetThreshold
          : DEFAULT_ALERT_TARGETS.budgetThreshold,
    }
  } catch {
    return { ...DEFAULT_ALERT_TARGETS }
  }
}

/** Persiste as metas (silencioso se o storage estiver indisponível). */
export function saveAlertTargets(targets: AlertTargets): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(targets))
  } catch {
    // Modo privado / storage cheio — metas valem só para a sessão.
  }
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
