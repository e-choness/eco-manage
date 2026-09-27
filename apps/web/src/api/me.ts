import type { InboxCounts, MeResponse } from '@ecomanage/shared';
import api, { errorMessage } from './api';

// Description: The signed-in user with their sites and role on each
// Endpoint: GET /api/auth/me
// Response: MeResponse (@ecomanage/shared)
export const getMe = async (): Promise<MeResponse> => {
  try {
    const response = await api.get('/api/auth/me');
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error });
  }
};

// Description: Open and closed Inbox counts, for the rail badge
// Endpoint: GET /api/inbox/counts
// Response: InboxCounts (@ecomanage/shared)
export const getInboxCounts = async (): Promise<InboxCounts> => {
  try {
    const response = await api.get('/api/inbox/counts');
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error });
  }
};
