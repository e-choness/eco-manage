import api from './api';

// Description: Get dashboard overview data
// Endpoint: GET /api/dashboard/overview
// Request: {}
// Response: { totalProduction: number, currentPower: number, dailyProduction: number, monthlyProduction: number, systemStatus: string, weatherCondition: string, temperature: number, savings: number, carbonOffset: number }
export const getDashboardOverview = () => {
  console.log('Fetching dashboard overview data');
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        totalProduction: 1247.5,
        currentPower: 8.2,
        dailyProduction: 45.8,
        monthlyProduction: 1247.5,
        systemStatus: 'optimal',
        weatherCondition: 'sunny',
        temperature: 24,
        savings: 2847.32,
        carbonOffset: 1.2
      });
    }, 500);
  });
  // try {
  //   return await api.get('/api/dashboard/overview');
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};

// Description: Get energy flow data
// Endpoint: GET /api/dashboard/energy-flow
// Request: {}
// Response: { solar: number, wind: number, battery: number, grid: number, consumption: number }
export const getEnergyFlow = () => {
  console.log('Fetching energy flow data');
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        solar: 6.5,
        wind: 1.7,
        battery: 2.1,
        grid: -0.8,
        consumption: 9.5
      });
    }, 500);
  });
  // try {
  //   return await api.get('/api/dashboard/energy-flow');
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};