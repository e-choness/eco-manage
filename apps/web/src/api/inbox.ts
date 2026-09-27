import type { AlertCause, AlertDetail, Check, CommandView, InboxPage, InboxType, RecommendationDetail } from '@ecomanage/shared';
import api, { errorMessage } from './api';

const call = async <T>(p: Promise<{ data: T }>): Promise<T> => {
  try {
    return (await p).data;
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error });
  }
};

// Description: Inbox items, newest first, paged with a cursor
// Endpoint: GET /api/inbox?state&type&limit&cursor
export const getInbox = (state: 'open' | 'closed', type: InboxType | 'all', cursor?: string): Promise<InboxPage> =>
  call(api.get('/api/inbox', { params: { state, type, limit: 30, ...(cursor ? { cursor } : {}) } }));

// ---- decisions ----------------------------------------------------------------------------------

// Endpoint: GET /api/recommendations/:id
export const getRecommendation = (id: string): Promise<RecommendationDetail> => call(api.get(`/api/recommendations/${id}`));

// Description: Checks and saving again with adjusted params (the Inbox slider)
// Endpoint: POST /api/recommendations/:id/check
export const checkRecommendation = (id: string, params: Record<string, unknown>): Promise<{ checks: Check[]; expectedSavingCents: number; calc: string; allPass: boolean }> =>
  call(api.post(`/api/recommendations/${id}/check`, { params }));

// Endpoint: POST /api/recommendations/:id/approve
export const approveRecommendation = (id: string, params?: Record<string, unknown>): Promise<{ commandId: string }> =>
  call(api.post(`/api/recommendations/${id}/approve`, params ? { params } : {}));

// Endpoint: POST /api/recommendations/:id/decline
export const declineRecommendation = (id: string, reason: string): Promise<unknown> => call(api.post(`/api/recommendations/${id}/decline`, { reason }));

// ---- commands -----------------------------------------------------------------------------------

// Endpoint: GET /api/commands/:id
export const getCommand = (id: string): Promise<CommandView> => call(api.get(`/api/commands/${id}`));

// Description: Stop early: dropped if not sent yet, otherwise reverted
// Endpoint: POST /api/commands/:id/cancel
export const cancelCommand = (id: string): Promise<CommandView> => call(api.post(`/api/commands/${id}/cancel`, {}));

// ---- alerts -------------------------------------------------------------------------------------

// Endpoint: GET /api/alerts/:id
export const getAlert = (id: string): Promise<AlertDetail> => call(api.get(`/api/alerts/${id}`));

// Endpoint: POST /api/alerts/:id/ack
export const ackAlert = (id: string): Promise<unknown> => call(api.post(`/api/alerts/${id}/ack`, {}));

// Description: Pause the alert's emails for 24 h; the alert stays open
// Endpoint: POST /api/alerts/:id/snooze
export const snoozeAlert = (id: string): Promise<unknown> => call(api.post(`/api/alerts/${id}/snooze`, {}));

// Description: Close with a cause; "False alarm" also mutes the check for the device for 7 days
// Endpoint: POST /api/alerts/:id/resolve
export const resolveAlert = (id: string, cause: AlertCause, note: string): Promise<unknown> => call(api.post(`/api/alerts/${id}/resolve`, { cause, note }));

// Description: Run a remote fix from the device profile (a command)
// Endpoint: POST /api/alerts/:id/fix
export const fixAlert = (id: string, fixId: string): Promise<unknown> => call(api.post(`/api/alerts/${id}/fix`, { fixId }));
