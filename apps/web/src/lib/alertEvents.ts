// Lets pages that change alerts tell the header to refresh its unread count now, instead of
// waiting for the next poll.
const EVENT = 'ecomanage:alerts-changed'

// Server-sent events replace polling in P1-08; until then no poll runs faster than this.
export const ALERT_POLL_MS = 30_000

export const notifyAlertsChanged = (): void => {
  window.dispatchEvent(new Event(EVENT))
}

export const onAlertsChanged = (listener: () => void): (() => void) => {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
