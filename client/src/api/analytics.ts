import api from './api';

// Description: Get energy production analytics
// Endpoint: GET /api/analytics/production
// Request: { period: string }
// Response: { data: Array<{ date: string, production: number }> }
export const getProductionAnalytics = async (period: string) => {
  try {
    const response = await api.get(`/api/analytics/production?period=${period}`);
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
  }
};

// Description: Get consumption analytics
// Endpoint: GET /api/analytics/consumption
// Request: { period: string }
// Response: { data: Array<{ date: string, consumption: number }> }
export const getConsumptionAnalytics = async (period: string) => {
  try {
    const response = await api.get(`/api/analytics/consumption?period=${period}`);
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
  }
};

export const getInsight = async (data: any) => {
  try {
    const response = await api.post('/api/analytics/insight', { data });
    return response.data;
  } catch (error) {
    console.error('Error getting insight:', error);
    throw error;
  }
};