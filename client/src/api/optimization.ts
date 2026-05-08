import api from './api';

// Description: Get optimization recommendations
// Endpoint: GET /api/optimization/recommendations
// Request: {}
// Response: Array<{ _id: string, title: string, description: string, priority: string, estimatedSavings: number, difficulty: string, category: string }>
export const getOptimizationRecommendations = async () => {
  try {
    const response = await api.get('/api/optimization/recommendations');
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
  }
};

// Description: Accept optimization recommendation
// Endpoint: POST /api/optimization/accept
// Request: { recommendationId: string }
// Response: { _id: string, status: string }
export const acceptRecommendation = async (recommendationId: string) => {
  try {
    const response = await api.post('/api/optimization/accept', { recommendationId });
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
  }
};