import type { AlertView } from '@ecomanage/shared';
import api, { errorMessage } from './api';
import type { Alert } from './types';

// The v2 Alerts API (P2-08) mapped onto the shape the current Alerts page and header use. The
// App v2 Inbox (P4-07) will use the v2 shape directly and replace this.

/** "Read" here means someone has acknowledged it; closed alerts count as read and resolved. */
export const fromView = (a: AlertView): Alert => ({
  _id: a.id,
  title: a.title,
  message: a.detail,
  type: a.severity,
  timestamp: a.openedAt,
  read: a.state !== 'open',
  resolved: a.state === 'resolved',
});

// Endpoint: GET /api/alerts?state=open and ?state=closed (newest first, 50 of each)
export const getAlerts = async (): Promise<{ alerts: Alert[] }> => {
  try {
    const [open, closed] = await Promise.all([
      api.get('/api/alerts', { params: { state: 'open' } }) as Promise<{ data: { items: AlertView[] } }>,
      api.get('/api/alerts', { params: { state: 'closed' } }) as Promise<{ data: { items: AlertView[] } }>,
    ]);
    const items = [...open.data.items, ...closed.data.items].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    return { alerts: items.map(fromView) };
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Endpoint: POST /api/alerts/:id/ack
export const markAlertAsRead = async (alertId: string): Promise<Alert> => {
  try {
    const response = (await api.post(`/api/alerts/${alertId}/ack`)) as { data: AlertView };
    return fromView(response.data);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};
