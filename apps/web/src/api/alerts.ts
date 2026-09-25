import api, { errorMessage } from './api';
import type { Alert } from './types';

// Description: Get all alerts
// Endpoint: GET /api/alerts
// Request: {}
// Response: Array<{ _id: string, title: string, message: string, type: string, timestamp: string, read: boolean, resolved: boolean }>
export const getAlerts = async (): Promise<{ alerts: Alert[] }> => {
  try {
    const response = await api.get('/api/alerts');
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Mark alert as read
// Endpoint: PUT /api/alerts/read
// Request: { alertId: string }
// Response: { _id: string, read: boolean }
export const markAlertAsRead = async (alertId: string): Promise<Alert> => {
  try {
    const response = await api.put('/api/alerts/read', { alertId });
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};