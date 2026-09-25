import { Request, Response, NextFunction } from 'express';
import UserService from '../../services/userService';
import { verifyAccessToken } from '../../utils/auth';
import { IUser } from '../../models/User';

export interface AuthenticatedRequest extends Request {
  user?: IUser;
}

// 401 for a missing, invalid or expired access token (the client then refreshes).
// Lookup failures are server errors and go to the error handler.
export const requireUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  try {
    const user = await UserService.get(userId);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
