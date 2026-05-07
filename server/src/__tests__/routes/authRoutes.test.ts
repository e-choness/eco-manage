/**
 * Auth Routes Integration Tests
 *
 * Full integration tests for authentication endpoints
 */

import request from 'supertest';
import express, { Express } from 'express';
import authRoutes from '../../routes/authRoutes';
import UserService from '../../services/userService';
import * as authUtils from '../../utils/auth';
import mongoose from 'mongoose';

jest.mock('../../services/userService');
jest.mock('../../utils/auth');

const mockUserService = UserService as jest.Mocked<typeof UserService>;
const mockAuthUtils = authUtils as jest.Mocked<typeof authUtils>;

describe('Auth Routes Integration Tests', () => {
  let app: Express;
  const userId = new mongoose.Types.ObjectId();
  const mockUser = {
    _id: userId,
    email: 'test@example.com',
    password: '$2b$10$uamYRlBMz0bBSBHzTzpVT.uygFgMZ.Jzq.dDFP3Dx2DZkGfWu6N0.',
    name: 'Test User',
    createdAt: new Date(),
    lastLoginAt: new Date(),
    isActive: true,
    refreshToken: 'old-refresh-token',
    save: jest.fn().mockResolvedValue(undefined),
    toJSON: jest.fn(() => ({
      _id: userId,
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date(),
      isActive: true,
    })),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      mockUserService.create.mockResolvedValue(mockUser as any);

      const response = await request(app).post('/api/auth/register').send({
        email: 'newuser@example.com',
        password: 'password123',
        name: 'New User',
      });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('email', 'test@example.com');
      expect(response.body).not.toHaveProperty('password');
      expect(mockUserService.create).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'password123',
        name: 'New User',
      });
    });

    it('should return 400 if email is missing', async () => {
      const response = await request(app).post('/api/auth/register').send({
        password: 'password123',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Email and password are required');
    });

    it('should return 400 if password is missing', async () => {
      const response = await request(app).post('/api/auth/register').send({
        email: 'test@example.com',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message');
    });

    it('should return 400 if user already exists', async () => {
      mockUserService.create.mockRejectedValue(new Error('User with this email already exists'));

      const response = await request(app).post('/api/auth/register').send({
        email: 'existing@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('User with this email already exists');
    });

    it('should not expose password in response', async () => {
      mockUserService.create.mockResolvedValue(mockUser as any);

      const response = await request(app).post('/api/auth/register').send({
        email: 'newuser@example.com',
        password: 'password123',
      });

      expect(response.body).not.toHaveProperty('password');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login user with correct credentials', async () => {
      const accessToken = 'mock-access-token';
      const refreshToken = 'mock-refresh-token';

      mockUserService.authenticateWithPassword.mockResolvedValue(mockUser as any);
      mockAuthUtils.generateAccessToken.mockReturnValue(accessToken);
      mockAuthUtils.generateRefreshToken.mockReturnValue(refreshToken);

      const response = await request(app).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken', accessToken);
      expect(response.body).toHaveProperty('refreshToken', refreshToken);
      expect(response.body).toHaveProperty('email', 'test@example.com');
      expect(response.body).not.toHaveProperty('password');
    });

    it('should return 400 if credentials are incorrect', async () => {
      mockUserService.authenticateWithPassword.mockResolvedValue(null);

      const response = await request(app).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'wrongpassword',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Email or password is incorrect');
    });

    it('should return 400 if email is missing', async () => {
      const response = await request(app).post('/api/auth/login').send({
        password: 'password123',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Email and password are required');
    });

    it('should return 400 if password is missing', async () => {
      const response = await request(app).post('/api/auth/login').send({
        email: 'test@example.com',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Email and password are required');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should return 401 if refresh token is missing', async () => {
      const response = await request(app).post('/api/auth/refresh').send({});

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.message).toContain('Refresh token is required');
    });

    it('should return 403 if refresh token is invalid', async () => {
      mockAuthUtils.verifyRefreshToken.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const response = await request(app).post('/api/auth/refresh').send({
        refreshToken: 'invalid-token',
      });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('success', false);
    });

    it('should return 403 if user not found', async () => {
      const mockPayload = { sub: userId.toString() };
      mockAuthUtils.verifyRefreshToken.mockReturnValue(mockPayload as any);
      mockUserService.get.mockResolvedValue(null);

      const response = await request(app).post('/api/auth/refresh').send({
        refreshToken: 'valid-token',
      });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('User not found');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return 401 if no authorization header', async () => {
      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('message', 'Unauthorized');
    });
  });

  describe('Response Format', () => {
    it('should not include password in user responses', async () => {
      mockUserService.create.mockResolvedValue(mockUser as any);

      const response = await request(app).post('/api/auth/register').send({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(response.body).not.toHaveProperty('password');
    });

    it('should include tokens in login response', async () => {
      mockUserService.authenticateWithPassword.mockResolvedValue(mockUser as any);
      mockAuthUtils.generateAccessToken.mockReturnValue('access');
      mockAuthUtils.generateRefreshToken.mockReturnValue('refresh');

      const response = await request(app).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
    });
  });
});
