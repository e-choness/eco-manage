import api from './api';

// Description: Get energy production analytics
// Endpoint: GET /api/analytics/production
// Request: { period: string }
// Response: { data: Array<{ date: string, solar: number, wind: number, total: number }> }
export const getProductionAnalytics = (period: string) => {
  console.log('Fetching production analytics for period:', period);
  return new Promise((resolve) => {
    setTimeout(() => {
      const data = [];
      const days = period === 'week' ? 7 : period === 'month' ? 30 : 365;
      
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        data.push({
          date: date.toISOString().split('T')[0],
          solar: Math.random() * 50 + 20,
          wind: Math.random() * 20 + 5,
          total: Math.random() * 70 + 25
        });
      }
      
      resolve({ data });
    }, 500);
  });
  // try {
  //   return await api.get(`/api/analytics/production?period=${period}`);
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};

// Description: Get consumption analytics
// Endpoint: GET /api/analytics/consumption
// Request: { period: string }
// Response: { data: Array<{ date: string, consumption: number, production: number }> }
export const getConsumptionAnalytics = (period: string) => {
  console.log('Fetching consumption analytics for period:', period);
  return new Promise((resolve) => {
    setTimeout(() => {
      const data = [];
      const days = period === 'week' ? 7 : period === 'month' ? 30 : 365;
      
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const production = Math.random() * 70 + 25;
        data.push({
          date: date.toISOString().split('T')[0],
          consumption: Math.random() * 60 + 20,
          production: production
        });
      }
      
      resolve({ data });
    }, 500);
  });
  // try {
  //   return await api.get(`/api/analytics/consumption?period=${period}`);
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};

export const getInsight = async (data: any) => {
  console.log('Fetching insight data', data);
  return new Promise((resolve) => {
    setTimeout(() => {
        const result = {
          insight: 'Production and Consumption Insight'
          // Add more insight data as needed
        };
        resolve(result); // Fix: Resolve the result directly
    }, 1000); // Simulating a 1-second delay
  });

  try {
    const response = await api.post('/insight', data);
    return response.data;
  } catch (error) {
    console.error('Error getting insight:', error);
    throw error;
  }
};