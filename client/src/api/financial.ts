import api from './api';

// Description: Get financial overview
// Endpoint: GET /api/financial/overview
// Request: {}
// Response: { totalSavings: number, monthlyRevenue: number, roi: number, paybackPeriod: number, maintenanceCosts: number }
export const getFinancialOverview = async () => {
  try {
    const response = await api.get('/api/financial/overview');
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
  }
};

// Description: Get financial history
// Endpoint: GET /api/financial/history
// Request: { period: string }
// Response: { period: string, data: Array<{ id: string, date: string, savings: number, revenue: number, costs: number }> }
export const getFinancialHistory = async (period: string) => {
  try {
    const response = await api.get(`/api/financial/history?period=${period}`);
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
  }
};