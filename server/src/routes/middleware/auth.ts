import { Request, Response, NextFunction } from 'express';
import UserService from '../../services/userService';
import { verifyAccessToken } from '../../utils/auth';
import { IUser } from '../../models/User';

export interface AuthenticatedRequest extends Request {
  user?: IUser;
}

export const requireUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const decoded = verifyAccessToken(token);
    const user = await UserService.get(decoded.sub);

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`Auth middleware error: ${error.message}`);
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};
