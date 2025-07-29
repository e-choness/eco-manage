import api from './api';

// Description: Get financial overview
// Endpoint: GET /api/financial/overview
// Request: {}
// Response: { totalSavings: number, monthlyRevenue: number, roi: number, paybackPeriod: number, maintenanceCosts: number }
export const getFinancialOverview = () => {
  console.log('Fetching financial overview');
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        totalSavings: 12847.32,
        monthlyRevenue: 456.78,
        roi: 18.5,
        paybackPeriod: 6.2,
        maintenanceCosts: 234.50
      });
    }, 500);
  });
  // try {
  //   return await api.get('/api/financial/overview');
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};

// Description: Get financial history
// Endpoint: GET /api/financial/history
// Request: { period: string }
// Response: { data: Array<{ date: string, savings: number, revenue: number, costs: number }> }
export const getFinancialHistory = (period: string) => {
  console.log('Fetching financial history for period:', period);
  return new Promise((resolve) => {
    setTimeout(() => {
      const data = [];
      const months = period === 'year' ? 12 : 6;
      
      for (let i = months - 1; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        data.push({
          date: date.toISOString().split('T')[0],
          savings: Math.random() * 500 + 300,
          revenue: Math.random() * 200 + 100,
          costs: Math.random() * 100 + 50
        });
      }
      
      resolve({ data });
    }, 500);
  });
  // try {
  //   return await api.get(`/api/financial/history?period=${period}`);
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};