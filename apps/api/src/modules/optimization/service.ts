import Recommendation, { IRecommendation } from './model';

type Decision = 'accepted' | 'dismissed';

export const listOpen = (userId: string): Promise<IRecommendation[]> =>
  Recommendation.find({ userId, status: { $in: ['pending', 'accepted'] } }).sort({ priority: -1, createdAt: -1 });

const decide = (userId: string, recommendationId: string, status: Decision): Promise<IRecommendation | null> =>
  Recommendation.findOneAndUpdate({ _id: recommendationId, userId }, { status }, { new: true });

export const accept = (userId: string, recommendationId: string): Promise<IRecommendation | null> =>
  decide(userId, recommendationId, 'accepted');

export const dismiss = (userId: string, recommendationId: string): Promise<IRecommendation | null> =>
  decide(userId, recommendationId, 'dismissed');
