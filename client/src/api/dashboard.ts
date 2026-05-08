import api from './api';

// Description: Get dashboard overview data
// Endpoint: GET /api/dashboard/overview
// Request: {}
// Response: { totalProduction: number, currentPower: number, dailyProduction: number, monthlyProduction: number, systemStatus: string, weatherCondition: string, temperature: number, savings: number, carbonOffset: number }
export const getDashboardOverview = async () => {
  try {
    const response = await api.get('/api/dashboard/overview');
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
  }
};

// Description: Get energy flow data
// Endpoint: GET /api/dashboard/energy-flow
// Request: {}
// Response: { solar: number, wind: number, battery: number, grid: number, consumption: number }
export const getEnergyFlow = async () => {
  try {
    const response = await api.get('/api/dashboard/energy-flow');
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
  }
};