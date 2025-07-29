import api from './api';

// Description: Get optimization recommendations
// Endpoint: GET /api/optimization/recommendations
// Request: {}
// Response: { recommendations: Array<{ _id: string, title: string, description: string, priority: string, estimatedSavings: number, difficulty: string, category: string }> }
export const getOptimizationRecommendations = () => {
  console.log('Fetching optimization recommendations');
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        recommendations: [
          {
            _id: '1',
            title: 'Optimize Solar Panel Angle',
            description: 'Adjust solar panel tilt angle to 35° for optimal winter performance',
            priority: 'high',
            estimatedSavings: 245.50,
            difficulty: 'medium',
            category: 'solar'
          },
          {
            _id: '2',
            title: 'Schedule High-Energy Appliances',
            description: 'Run dishwasher and washing machine during peak solar production hours (11 AM - 3 PM)',
            priority: 'medium',
            estimatedSavings: 89.30,
            difficulty: 'easy',
            category: 'consumption'
          },
          {
            _id: '3',
            title: 'Battery Charging Optimization',
            description: 'Adjust battery charging schedule to store excess solar energy during peak production',
            priority: 'high',
            estimatedSavings: 156.80,
            difficulty: 'easy',
            category: 'battery'
          },
          {
            _id: '4',
            title: 'Wind Turbine Maintenance',
            description: 'Clean wind turbine blades to improve efficiency by 12%',
            priority: 'medium',
            estimatedSavings: 78.20,
            difficulty: 'hard',
            category: 'wind'
          }
        ]
      });
    }, 500);
  });
  // try {
  //   return await api.get('/api/optimization/recommendations');
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};

// Description: Accept optimization recommendation
// Endpoint: POST /api/optimization/accept
// Request: { recommendationId: string }
// Response: { success: boolean, message: string }
export const acceptRecommendation = (recommendationId: string) => {
  console.log('Accepting recommendation:', recommendationId);
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        success: true,
        message: 'Recommendation accepted and scheduled for implementation'
      });
    }, 500);
  });
  // try {
  //   return await api.post('/api/optimization/accept', { recommendationId });
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};