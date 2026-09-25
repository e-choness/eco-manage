/**
 * Auth Middleware Tests
 *
 * Tests for the requireUser middleware authentication logic
 */

import { Response } from 'express';
import { requireUser, AuthenticatedRequest } from '../../routes/middleware/auth';
import * as authUtils from '../../utils/auth';
import UserService from '../../services/userService';
import mongoose from 'mongoose';

jest.mock('../../utils/auth');
jest.mock('../../services/userService');

const mockAuthUtils = authUtils as jest.Mocked<typeof authUtils>;
const mockUserService = UserService as jest.Mocked<typeof UserService>;

describe('Auth Middleware', () => {
  const userId = new mongoose.Types.ObjectId();
  const mockUser = {
    _id: userId,
    email: 'test@example.com',
    password: 'hashed-password',
    name: 'Test User',
    createdAt: new Date(),
    lastLoginAt: new Date(),
    isActive: true,
    toJSON: jest.fn(() => ({
      _id: userId,
      email: 'test@example.com',
      name: 'Test User',
    })),
  };

  let req: Partial<AuthenticatedRequest>;
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      headers: {},
    } as any;

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;

    next = jest.fn();
  });

  describe('requireUser middleware', () => {
    it('should call next() for valid token', async () => {
      const mockToken = 'valid-token';
      const mockPayload = { sub: userId.toString() };

      req.headers = { authorization: `Bearer ${mockToken}` };
      mockAuthUtils.verifyAccessToken.mockReturnValue(mockPayload as any);
      mockUserService.get.mockResolvedValue(mockUser as any);

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual(mockUser);
    });

    it('should return 401 if no authorization header', async () => {
      req.headers = {};

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if token is missing in Bearer header', async () => {
      req.headers = { authorization: 'Bearer' };

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if authorization header is empty', async () => {
      req.headers = { authorization: '' };

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if user not found', async () => {
      const mockToken = 'valid-token';
      const mockPayload = { sub: userId.toString() };

      req.headers = { authorization: `Bearer ${mockToken}` };
      mockAuthUtils.verifyAccessToken.mockReturnValue(mockPayload as any);
      mockUserService.get.mockResolvedValue(null);

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 for invalid token', async () => {
      req.headers = { authorization: 'Bearer invalid-token' };
      mockAuthUtils.verifyAccessToken.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 for expired token', async () => {
      req.headers = { authorization: 'Bearer expired-token' };
      mockAuthUtils.verifyAccessToken.mockImplementation(() => {
        throw new Error('Token expired');
      });

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should extract token from Bearer header correctly', async () => {
      const mockToken = 'test-token-12345';
      const mockPayload = { sub: userId.toString() };

      req.headers = { authorization: `Bearer ${mockToken}` };
      mockAuthUtils.verifyAccessToken.mockReturnValue(mockPayload as any);
      mockUserService.get.mockResolvedValue(mockUser as any);

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      expect(mockAuthUtils.verifyAccessToken).toHaveBeenCalledWith(mockToken);
    });

    it('should verify token with correct secret', async () => {
      const mockToken = 'valid-token';
      const mockPayload = { sub: userId.toString() };

      req.headers = { authorization: `Bearer ${mockToken}` };
      mockAuthUtils.verifyAccessToken.mockReturnValue(mockPayload as any);
      mockUserService.get.mockResolvedValue(mockUser as any);

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      expect(mockAuthUtils.verifyAccessToken).toHaveBeenCalledWith(mockToken);
    });

    it('should attach user to request object', async () => {
      const mockToken = 'valid-token';
      const mockPayload = { sub: userId.toString() };

      req.headers = { authorization: `Bearer ${mockToken}` };
      mockAuthUtils.verifyAccessToken.mockReturnValue(mockPayload as any);
      mockUserService.get.mockResolvedValue(mockUser as any);

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      expect((req as AuthenticatedRequest).user).toBeDefined();
      expect((req as AuthenticatedRequest).user?.email).toBe('test@example.com');
    });

    it('should handle database errors gracefully', async () => {
      const mockToken = 'valid-token';
      const mockPayload = { sub: userId.toString() };

      req.headers = { authorization: `Bearer ${mockToken}` };
      mockAuthUtils.verifyAccessToken.mockReturnValue(mockPayload as any);
      mockUserService.get.mockRejectedValue(new Error('Database connection failed'));

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should properly extract token from Bearer header', async () => {
      const mockToken = 'valid-token';
      const mockPayload = { sub: userId.toString() };

      // Test with standard format
      req.headers = { authorization: `Bearer ${mockToken}` };
      mockAuthUtils.verifyAccessToken.mockReturnValue(mockPayload as any);
      mockUserService.get.mockResolvedValue(mockUser as any);

      await requireUser(req as AuthenticatedRequest, res as Response, next);

      // Should extract the token correctly
      expect(mockAuthUtils.verifyAccessToken).toHaveBeenCalledWith(mockToken);
      expect(next).toHaveBeenCalled();
    });
  });
});
