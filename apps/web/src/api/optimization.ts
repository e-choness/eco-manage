import type { RecommendationView } from '@ecomanage/shared';
import api, { errorMessage } from './api';
import type { Recommendation } from './types';

// The v2 Recommendations API (P3-03) mapped onto the shape the current Optimization page uses.
// The App v2 Inbox (P4-07) will use the v2 shape directly, with checks and the adjust slider.

const HIGH_CENTS = 10_000;
const MEDIUM_CENTS = 1_000;

export const fromView = (r: RecommendationView): Recommendation => ({
  _id: r.id,
  title: r.title,
  description: `${r.ruleTitle} · ${r.deviceName ?? r.deviceId}`,
  priority: r.expectedSavingCents >= HIGH_CENTS ? 'high' : r.expectedSavingCents >= MEDIUM_CENTS ? 'medium' : 'low',
  estimatedSavings: r.expectedSavingCents / 100,
  difficulty: 'easy',
  category: r.ruleTitle,
  status: r.status === 'proposed' ? 'pending' : r.status === 'declined' ? 'dismissed' : 'accepted',
});

// Endpoint: GET /api/recommendations?state=open
export const getOptimizationRecommendations = async (): Promise<{ recommendations: Recommendation[] }> => {
  try {
    const response = (await api.get('/api/recommendations', { params: { state: 'open' } })) as { data: { items: RecommendationView[] } };
    return { recommendations: response.data.items.map(fromView) };
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Endpoint: POST /api/recommendations/:id/approve (checks run again; 409 if one fails)
export const acceptRecommendation = async (recommendationId: string): Promise<Recommendation> => {
  try {
    const response = (await api.post(`/api/recommendations/${recommendationId}/approve`, {})) as { data: { recommendation: RecommendationView } };
    return fromView(response.data.recommendation);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Endpoint: POST /api/recommendations/:id/decline (a reason is required)
export const dismissRecommendation = async (recommendationId: string): Promise<Recommendation> => {
  try {
    const response = (await api.post(`/api/recommendations/${recommendationId}/decline`, { reason: 'Dismissed on the Optimization page' })) as {
      data: RecommendationView;
    };
    return fromView(response.data);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};
