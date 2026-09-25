import type { SiteSnapshot } from '@ecomanage/shared';
import api, { errorMessage } from './api';

// Description: Everything the live view needs on load
// Endpoint: GET /api/site/snapshot
// Response: SiteSnapshot (@ecomanage/shared)
export const getSnapshot = async (): Promise<SiteSnapshot> => {
  try {
    const response = await api.get('/api/site/snapshot');
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};
