import type { InboxPage, SiteModel, SiteToday } from '@ecomanage/shared';
import api, { errorMessage } from './api';

const call = async <T>(p: Promise<{ data: T }>): Promise<T> => {
  try {
    return (await p).data;
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error });
  }
};

// Description: The scene Home draws (the App v2 demo scene until a model is saved)
// Endpoint: GET /api/site/model
export const getSiteModel = (): Promise<SiteModel> => call(api.get('/api/site/model'));

// Description: Today's price periods, and the bill so far for owners and managers
// Endpoint: GET /api/site/today
export const getToday = (): Promise<SiteToday> => call(api.get('/api/site/today'));

// Description: Open Inbox items, newest first (Home shows the top of it)
// Endpoint: GET /api/inbox?state=open&limit=
export const getOpenInbox = (limit: number): Promise<InboxPage> => call(api.get('/api/inbox', { params: { state: 'open', limit } }));

// Description: Approve a proposal as proposed; it becomes a command sent at its window
// Endpoint: POST /api/recommendations/:id/approve
export const approveRecommendation = (id: string): Promise<{ commandId: string }> => call(api.post(`/api/recommendations/${id}/approve`, {}));

// Description: Decline a proposal; the reason tunes the rule
// Endpoint: POST /api/recommendations/:id/decline
export const declineRecommendation = (id: string, reason: string): Promise<unknown> => call(api.post(`/api/recommendations/${id}/decline`, { reason }));
