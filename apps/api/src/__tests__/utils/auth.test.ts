/**
 * Auth Utility Tests
 *
 * Tests for JWT token generation and verification functions
 */

import jwt from 'jsonwebtoken';
import { generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken, TokenPayload } from '../../utils/auth';
import { IUser } from '../../models/User';
import mongoose from 'mongoose';

// Mock jwt module
jest.mock('jsonwebtoken');

const mockJwt = jwt as unknown as {
  sign: jest.Mock;
  verify: jest.Mock;
};

describe('Auth Utilities', () => {
  const userId = new mongoose.Types.ObjectId();
  const mockUser = {
    _id: userId,
    email: 'test@example.com',
    password: '$2b$10$uamYRlBMz0bBSBHzTzpVT.uygFgMZ.Jzq.dDFP3Dx2DZkGfWu6N0.',
  } as any as IUser;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
  });

  describe('generateAccessToken', () => {
    it('should generate a valid access token', () => {
      const mockToken = 'mock-access-token';
      mockJwt.sign.mockReturnValue(mockToken);

      const token = generateAccessToken(mockUser as IUser);

      expect(token).toBe(mockToken);
      expect(mockJwt.sign).toHaveBeenCalledWith(
        { sub: mockUser._id?.toString() },
        'test-jwt-secret',
        { expiresIn: '1d' }
      );
    });

    it('should include user ID in token payload', () => {
      mockJwt.sign.mockReturnValue('token');

      generateAccessToken(mockUser as IUser);

      const call = mockJwt.sign.mock.calls[0];
      expect(call[0]).toEqual({ sub: mockUser._id?.toString() });
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid refresh token', () => {
      const mockToken = 'mock-refresh-token';
      mockJwt.sign.mockReturnValue(mockToken);

      const token = generateRefreshToken(mockUser as IUser);

      expect(token).toBe(mockToken);
      expect(mockJwt.sign).toHaveBeenCalledWith(
        { sub: mockUser._id?.toString() },
        'test-refresh-secret',
        { expiresIn: '30d' }
      );
    });

    it('should have longer expiration than access token', () => {
      mockJwt.sign.mockReturnValue('token');

      generateRefreshToken(mockUser as IUser);

      const call = mockJwt.sign.mock.calls[0];
      expect(call[2]).toEqual({ expiresIn: '30d' });
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify and return token payload', () => {
      const mockPayload: TokenPayload = {
        sub: mockUser._id?.toString() || '',
        iat: Date.now(),
        exp: Date.now() + 86400000,
      };
      mockJwt.verify.mockReturnValue(mockPayload);

      const result = verifyAccessToken('valid-token');

      expect(result).toEqual(mockPayload);
      expect(mockJwt.verify).toHaveBeenCalledWith('valid-token', 'test-jwt-secret');
    });

    it('should throw error for invalid token', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new jwt.JsonWebTokenError('Invalid token');
      });

      expect(() => verifyAccessToken('invalid-token')).toThrow();
    });

    it('should throw error for expired token', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new jwt.TokenExpiredError('Token expired', new Date());
      });

      expect(() => verifyAccessToken('expired-token')).toThrow();
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify and return refresh token payload', () => {
      const mockPayload: TokenPayload = {
        sub: mockUser._id?.toString() || '',
        iat: Date.now(),
        exp: Date.now() + 2592000000,
      };
      mockJwt.verify.mockReturnValue(mockPayload);

      const result = verifyRefreshToken('valid-refresh-token');

      expect(result).toEqual(mockPayload);
      expect(mockJwt.verify).toHaveBeenCalledWith('valid-refresh-token', 'test-refresh-secret');
    });

    it('should throw error for invalid refresh token', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new jwt.JsonWebTokenError('Invalid token');
      });

      expect(() => verifyRefreshToken('invalid-refresh-token')).toThrow();
    });

    it('should throw error for expired refresh token', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new jwt.TokenExpiredError('Refresh token expired', new Date());
      });

      expect(() => verifyRefreshToken('expired-refresh-token')).toThrow();
    });
  });

  describe('Token payload structure', () => {
    it('should have required sub field', () => {
      mockJwt.sign.mockReturnValue('token');

      generateAccessToken(mockUser as IUser);

      const payload = mockJwt.sign.mock.calls[0][0] as TokenPayload;
      expect(payload).toHaveProperty('sub');
      expect(typeof payload.sub).toBe('string');
    });
  });
});
