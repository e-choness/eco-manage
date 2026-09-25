import Recommendation, { IRecommendation } from './model';

export const listOpen = (userId: string): Promise<IRecommendation[]> =>
  Recommendation.find({ userId, status: { $in: ['pending', 'accepted'] } }).sort({ priority: -1, createdAt: -1 });

export const accept = (userId: string, recommendationId: string): Promise<IRecommendation | null> =>
  Recommendation.findOneAndUpdate({ _id: recommendationId, userId }, { status: 'accepted' }, { new: true });
