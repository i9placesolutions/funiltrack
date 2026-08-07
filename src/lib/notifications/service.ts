/**
 * Abstração de notificações do FunilTrack.
 *
 * Comportamento garantido: NADA quebra se a Notification API estiver
 * indisponível (navegador sem suporte, contexto não seguro) ou se o usuário
 * negar a permissão — nesses casos `notify` retorna `false` e o chamador
 * deve exibir o aviso na central de alertas in-app (fallback padrão).
 *
 * Preparado para Web Push (futuro): a API é modelada como um "canal"
 * (`NotificationChannel`). Para evoluir para push real com VAPID basta
 * adicionar um segundo canal que registre um service worker, subscreva via
 * `PushManager.subscribe({ applicationServerKey: vapidPublicKey })` e envie
 * a subscription ao backend — a interface de `notify` permanece a mesma.
 */

export interface NotifyOptions {
  /** Corpo da notificação. */
  body?: string
  /** Tag para agrupar/substituir notificações iguais. */
  tag?: string
}

export type NotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported'

/** Interface de canal de notificação (local hoje; Web Push/VAPID no futuro). */
export interface NotificationChannel {
  /** Nome do canal (ex.: 'local', futuramente 'web-push'). */
  readonly name: string
  /**
   * Envia uma notificação. Retorna `true` se exibida com sucesso;
   * `false` caso contrário (o chamador faz fallback para a central in-app).
   */
  send(title: string, options?: NotifyOptions): boolean
}

/** A Notification API está disponível neste contexto? */
export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** Estado atual da permissão (com 'unsupported' quando não há API). */
export function getNotificationPermission(): NotificationPermissionState {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.permission
}

/**
 * Pede permissão de notificação de forma segura.
 * Nunca lança: resolve sempre com um estado (inclusive 'unsupported' ou
 * 'default' se o navegador rejeitar o prompt).
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!isNotificationSupported()) return 'unsupported'
  try {
    const result = await Notification.requestPermission()
    return result
  } catch {
    // Alguns navegadores antigos usam callback ou bloqueiam o prompt.
    return Notification.permission
  }
}

/** Canal local baseado na Notification API do navegador. */
const localChannel: NotificationChannel = {
  name: 'local',
  send(title: string, options: NotifyOptions = {}): boolean {
    if (getNotificationPermission() !== 'granted') return false
    try {
      new Notification(title, { body: options.body, tag: options.tag })
      return true
    } catch {
      // Android WebView etc. podem exigir service worker — cai no fallback.
      return false
    }
  },
}

const channels: NotificationChannel[] = [localChannel]

/**
 * Envia uma notificação usando o primeiro canal disponível.
 * Sempre seguro: retorna `false` (sem exceções) quando não foi possível
 * notificar — o chamador mantém o alerta na central in-app.
 */
export function notify(title: string, options: NotifyOptions = {}): boolean {
  for (const channel of channels) {
    if (channel.send(title, options)) return true
  }
  return false
}
