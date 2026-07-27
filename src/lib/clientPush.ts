export interface ClientPushResult {
  subscriptionsFound: number
  sent: number
  failed: number
}

export type ClientPushOutcome =
  | { status: 'sent'; result: ClientPushResult }
  | { status: 'no-subscription'; result: ClientPushResult }
  | { status: 'failed'; result?: ClientPushResult }

export function parseClientPushResult(data: unknown, hasError = false): ClientPushOutcome {
  if (hasError || !data || typeof data !== 'object') return { status: 'failed' }
  const candidate = data as Partial<ClientPushResult>
  if (![candidate.subscriptionsFound, candidate.sent, candidate.failed].every(Number.isInteger)) {
    return { status: 'failed' }
  }
  const result = candidate as ClientPushResult
  if (result.sent > 0 && result.failed === 0) return { status: 'sent', result }
  if (result.subscriptionsFound === 0 && result.sent === 0) return { status: 'no-subscription', result }
  return { status: 'failed', result }
}

export function savedMessagePushNotice(outcome: ClientPushOutcome) {
  if (outcome.status === 'sent') return 'Poruka je spremljena i push obavijest je poslana klijentu.'
  if (outcome.status === 'no-subscription') {
    return 'Poruka je spremljena. Klijent nema aktivne obavijesti na ovom uređaju.'
  }
  return 'Poruka je spremljena, ali push obavijest nije poslana.'
}

export const CLIENT_MESSAGES_HASH = '#/client/messages'

export function isClientMessagesLocation(hash: string) {
  return hash === CLIENT_MESSAGES_HASH
}
