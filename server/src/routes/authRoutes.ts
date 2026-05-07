import { Router, Response } from 'express';
import UserService from '../services/userService.js';
import { requireUser, AuthenticatedRequest } from './middleware/auth.js';
import User from '../models/User.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/auth.js';
import jwt from 'jsonwebtoken';

const router = Router();

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

      res.json({ ...user.toJSON(), accessToken, refreshToken });
    } else {
      res.status(400).json({ message: 'Email or password is incorrect' });
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Login error: ${err.message}`);
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
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Registration error: ${err.message}`);
    res.status(400).json({ message: err.message });
  }
});

router.post('/logout', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (user) {
      user.refreshToken = undefined;
      await user.save();
    }

    res.status(200).json({ message: 'User logged out successfully.' });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Logout error: ${err.message}`);
    res.status(500).json({ message: 'Logout failed' });
  }
});

router.post('/refresh', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(401).json({
        success: false,
        message: 'Refresh token is required',
      });
      return;
    }

    try {
      const decoded = verifyRefreshToken(refreshToken);
      const user = await UserService.get(decoded.sub);

      if (!user) {
        res.status(403).json({
          success: false,
          message: 'User not found',
        });
        return;
      }

      if (user.refreshToken !== refreshToken) {
        res.status(403).json({
          success: false,
          message: 'Invalid refresh token',
        });
        return;
      }

      const newAccessToken = generateAccessToken(user);
      const newRefreshToken = generateRefreshToken(user);

      user.refreshToken = newRefreshToken;
      await user.save();

      res.status(200).json({
        success: true,
        data: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`Token refresh error: ${err.message}`);

      if (err instanceof jwt.TokenExpiredError) {
        res.status(403).json({
          success: false,
          message: 'Refresh token has expired',
        });
      } else {
        res.status(403).json({
          success: false,
          message: 'Invalid refresh token',
        });
      }
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Refresh endpoint error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Refresh failed' });
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
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Get user error: ${err.message}`);
    res.status(500).json({ message: 'Failed to get user' });
  }
});

export default router;
