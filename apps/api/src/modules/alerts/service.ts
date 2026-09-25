import Alert, { IAlert } from './model';

export const listAlerts = (userId: string): Promise<IAlert[]> => Alert.find({ userId }).sort({ timestamp: -1 });

export const markRead = (userId: string, alertId: string): Promise<IAlert | null> =>
  Alert.findOneAndUpdate({ _id: alertId, userId }, { read: true }, { new: true });
