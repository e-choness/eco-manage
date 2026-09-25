import api, { errorMessage } from './api';
import type { ConsumptionPoint, ProductionPoint } from './types';

// Description: Get energy production analytics
// Endpoint: GET /api/analytics/production
// Request: { period: string }
// Response: { data: Array<{ date: string, production: number }> }
export const getProductionAnalytics = async (period: string): Promise<{ period: string; data: ProductionPoint[] }> => {
  try {
    const response = await api.get(`/api/analytics/production?period=${period}`);
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Get consumption analytics
// Endpoint: GET /api/analytics/consumption
// Request: { period: string }
// Response: { data: Array<{ date: string, consumption: number }> }
export const getConsumptionAnalytics = async (period: string): Promise<{ period: string; data: ConsumptionPoint[] }> => {
  try {
    const response = await api.get(`/api/analytics/consumption?period=${period}`);
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};
