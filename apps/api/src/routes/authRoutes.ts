import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import UserService from '../services/userService';
import { requireUser, AuthenticatedRequest } from './middleware/auth';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/auth';
import { clearRefreshCookie, readCookie, REFRESH_COOKIE, setRefreshCookie } from '../utils/cookies';
import { logger } from '../config/logger';

const router = Router();

const errMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The refresh token travels only in an httpOnly cookie; the access token is returned in the
// body and kept in memory by the client.
router.post('/login', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required' });
      return;
    }

    const user = await UserService.authenticateWithPassword(email, password);

    if (user) {
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      user.refreshToken = refreshToken;
      await user.save();

      setRefreshCookie(res, refreshToken);
      res.json({ ...user.toJSON(), accessToken });
    } else {
      res.status(400).json({ message: 'Email or password is incorrect' });
    }
  } catch (error) {
    logger.error({ err: errMessage(error) }, 'login failed');
    res.status(400).json({ message: 'Login failed' });
  }
});

router.post('/register', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required' });
      return;
    }

    const user = await UserService.create({ email, password, name });
    res.status(201).json(user.toJSON());
  } catch (error) {
    logger.warn({ err: errMessage(error) }, 'registration failed');
    res.status(400).json({ message: errMessage(error) });
  }
});

// Logs out the session that owns the refresh cookie. Unknown or expired cookies are
// simply cleared.
router.post('/logout', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = readCookie(req, REFRESH_COOKIE);
    if (token) {
      try {
        const user = await UserService.get(verifyRefreshToken(token).sub);
        if (user && user.refreshToken === token) {
          user.refreshToken = undefined;
          await user.save();
        }
      } catch {
        // invalid or expired token: nothing to revoke
      }
    }
    clearRefreshCookie(res);
    res.status(200).json({ message: 'User logged out successfully.' });
  } catch (error) {
    logger.error({ err: errMessage(error) }, 'logout failed');
    res.status(500).json({ message: 'Logout failed' });
  }
});

router.post('/refresh', async (req: AuthenticatedRequest, res: Response) => {
  const token = readCookie(req, REFRESH_COOKIE);
  if (!token) {
    res.status(401).json({ message: 'Refresh token is required' });
    return;
  }

  try {
    const user = await UserService.get(verifyRefreshToken(token).sub);

    if (!user || user.refreshToken !== token) {
      clearRefreshCookie(res);
      res.status(401).json({ message: 'Invalid refresh token' });
      return;
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    user.refreshToken = refreshToken;
    await user.save();

    setRefreshCookie(res, refreshToken);
    res.status(200).json({ accessToken, user: user.toJSON() });
  } catch (error) {
    clearRefreshCookie(res);
    const expired = error instanceof jwt.TokenExpiredError;
    res.status(401).json({ message: expired ? 'Refresh token has expired' : 'Invalid refresh token' });
  }
});

router.get('/me', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    res.status(200).json(req.user.toJSON());
  } catch (error) {
    logger.error({ err: errMessage(error) }, 'get user failed');
    res.status(500).json({ message: 'Failed to get user' });
  }
});

router.put('/password', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ message: 'Current password and new password are required' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ message: 'New password must be at least 6 characters' });
      return;
    }

    const user = await UserService.authenticateWithPassword(req.user!.email, currentPassword);
    if (!user) {
      res.status(400).json({ message: 'Current password is incorrect' });
      return;
    }

    await UserService.setPassword(user, newPassword);
    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    logger.error({ err: errMessage(error) }, 'change password failed');
    res.status(500).json({ message: 'Failed to change password' });
  }
});

router.put('/profile', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name } = req.body;

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      res.status(400).json({ message: 'Name must be a non-empty string' });
      return;
    }

    const updated = await UserService.update(String(req.user!._id), { name: name?.trim() });
    if (!updated) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(200).json(updated.toJSON());
  } catch (error) {
    logger.error({ err: errMessage(error) }, 'update profile failed');
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

export default router;
