import api, { errorMessage } from './api';
import type { Recommendation } from './types';

// Description: Get optimization recommendations
// Endpoint: GET /api/optimization/recommendations
// Request: {}
// Response: Array<{ _id: string, title: string, description: string, priority: string, estimatedSavings: number, difficulty: string, category: string }>
export const getOptimizationRecommendations = async (): Promise<{ recommendations: Recommendation[] }> => {
  try {
    const response = await api.get('/api/optimization/recommendations');
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Accept optimization recommendation
// Endpoint: POST /api/optimization/accept
// Request: { recommendationId: string }
// Response: { _id: string, status: string }
export const acceptRecommendation = async (recommendationId: string): Promise<Recommendation> => {
  try {
    const response = await api.post('/api/optimization/accept', { recommendationId });
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};
// Description: Dismiss optimization recommendation
// Endpoint: POST /api/optimization/dismiss
// Request: { recommendationId: string }
// Response: { _id: string, status: 'dismissed' }
export const dismissRecommendation = async (recommendationId: string): Promise<Recommendation> => {
  try {
    const response = await api.post('/api/optimization/dismiss', { recommendationId });
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};
