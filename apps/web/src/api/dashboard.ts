import api, { errorMessage } from './api';
import type { DashboardOverview, EnergyFlow } from './types';

// Description: Get dashboard overview data
// Endpoint: GET /api/dashboard/overview
// Request: {}
// Response: DashboardOverview (see ./types)
export const getDashboardOverview = async (): Promise<DashboardOverview> => {
  try {
    const response = await api.get('/api/dashboard/overview');
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Get energy flow data
// Endpoint: GET /api/dashboard/energy-flow
// Request: {}
// Response: EnergyFlow (see ./types); grid is positive when importing
export const getEnergyFlow = async (): Promise<EnergyFlow> => {
  try {
    const response = await api.get('/api/dashboard/energy-flow');
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};