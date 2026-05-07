/**
 * User Service Tests
 *
 * Tests for UserService CRUD operations with mocked Mongoose User model
 */

import mongoose from 'mongoose';
import UserService from '../../services/userService';
import * as passwordUtils from '../../utils/password';

// Mock User model
jest.mock('../../models/User');
// Mock password utilities
jest.mock('../../utils/password');

import User from '../../models/User';

const mockUser = User as unknown as {
  findOne: jest.Mock;
  find: jest.Mock;
  findOneAndUpdate: jest.Mock;
  deleteOne: jest.Mock;
  prototype: any;
};
const mockPasswordUtils = passwordUtils as jest.Mocked<typeof passwordUtils>;

describe('UserService', () => {
  const userId = new mongoose.Types.ObjectId();
  const mockUserData = {
    _id: userId,
    email: 'test@example.com',
    password: '$2b$10$uamYRlBMz0bBSBHzTzpVT.uygFgMZ.Jzq.dDFP3Dx2DZkGfWu6N0.',
    name: 'Test User',
    createdAt: new Date(),
    lastLoginAt: new Date(),
    isActive: true,
    refreshToken: 'some-token-123',
    save: jest.fn(),
    toJSON: jest.fn(() => ({
      _id: userId,
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date(),
      lastLoginAt: new Date(),
      isActive: true,
    })),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPasswordUtils.generatePasswordHash.mockResolvedValue('hashed-password');
    mockPasswordUtils.validatePassword.mockResolvedValue(true);
  });

  describe('create', () => {
    it('should create a new user with valid input', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      mockUser.prototype.save = jest.fn().mockResolvedValue(mockUserData);

      const result = await UserService.create({
        email: 'newuser@example.com',
        password: 'password123',
        name: 'New User',
      });

      expect(mockPasswordUtils.generatePasswordHash).toHaveBeenCalledWith('password123');
      expect(result).toBeDefined();
    });

    it('should throw error if email already exists', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUserData),
      });

      await expect(
        UserService.create({
          email: 'test@example.com',
          password: 'password123',
        })
      ).rejects.toThrow('User with this email already exists');
    });

    it('should throw error if email is missing', async () => {
      await expect(
        UserService.create({
          email: '',
          password: 'password123',
        })
      ).rejects.toThrow('Email is required');
    });

    it('should throw error if password is missing', async () => {
      await expect(
        UserService.create({
          email: 'test@example.com',
          password: '',
        })
      ).rejects.toThrow('Password is required');
    });

    it('should create user with default name if not provided', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      mockUser.prototype.save = jest.fn().mockResolvedValue(mockUserData);

      await UserService.create({
        email: 'newuser@example.com',
        password: 'password123',
      });

      expect(mockPasswordUtils.generatePasswordHash).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('should return user by id', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUserData),
      });

      const result = await UserService.get(userId.toString());

      expect(result).toEqual(mockUserData);
      expect(mockUser.findOne).toHaveBeenCalledWith({ _id: userId.toString() });
    });

    it('should return null if user not found', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const result = await UserService.get('nonexistent-id');

      expect(result).toBeNull();
    });

    it('should throw error on database error', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('Database connection error')),
      });

      await expect(UserService.get(userId.toString())).rejects.toThrow(
        'Database error while getting the user by their ID'
      );
    });
  });

  describe('getByEmail', () => {
    it('should return user by email', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUserData),
      });

      const result = await UserService.getByEmail('test@example.com');

      expect(result).toEqual(mockUserData);
      expect(mockUser.findOne).toHaveBeenCalledWith({ email: 'test@example.com' });
    });

    it('should return null if email not found', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const result = await UserService.getByEmail('notfound@example.com');

      expect(result).toBeNull();
    });

    it('should throw error on database error', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('Database error')),
      });

      await expect(UserService.getByEmail('test@example.com')).rejects.toThrow(
        'Database error while getting the user by their email'
      );
    });
  });

  describe('list', () => {
    it('should return all users', async () => {
      const users = [mockUserData, { ...mockUserData, email: 'another@example.com' }];
      mockUser.find.mockResolvedValue(users);

      const result = await UserService.list();

      expect(result).toEqual(users);
      expect(mockUser.find).toHaveBeenCalled();
    });

    it('should return empty array if no users', async () => {
      mockUser.find.mockResolvedValue([]);

      const result = await UserService.list();

      expect(result).toEqual([]);
    });

    it('should throw error on database error', async () => {
      mockUser.find.mockRejectedValue(new Error('Database connection failed'));

      await expect(UserService.list()).rejects.toThrow('Database error while listing users');
    });
  });

  describe('update', () => {
    it('should update user data', async () => {
      const updatedData = { ...mockUserData, name: 'Updated Name' };
      mockUser.findOneAndUpdate.mockResolvedValue(updatedData);

      const result = await UserService.update(userId.toString(), { email: 'updated@example.com' } as any);

      expect(result).toEqual(updatedData);
      expect(mockUser.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userId.toString() },
        expect.any(Object),
        { new: true, upsert: false }
      );
    });

    it('should return null if user not found', async () => {
      mockUser.findOneAndUpdate.mockResolvedValue(null);

      const result = await UserService.update('nonexistent-id', { email: 'updated@example.com' } as any);

      expect(result).toBeNull();
    });

    it('should throw error on database error', async () => {
      mockUser.findOneAndUpdate.mockRejectedValue(new Error('Update failed'));

      await expect(
        UserService.update(userId.toString(), { email: 'updated@example.com' } as any)
      ).rejects.toThrow('Database error while updating user');
    });
  });

  describe('delete', () => {
    it('should delete user successfully', async () => {
      mockUser.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });

      const result = await UserService.delete(userId.toString());

      expect(result).toBe(true);
      expect(mockUser.deleteOne).toHaveBeenCalledWith({ _id: userId.toString() });
    });

    it('should return false if user not found', async () => {
      mockUser.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      });

      const result = await UserService.delete('nonexistent-id');

      expect(result).toBe(false);
    });

    it('should throw error on database error', async () => {
      mockUser.deleteOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('Delete failed')),
      });

      await expect(UserService.delete(userId.toString())).rejects.toThrow(
        'Database error while deleting user'
      );
    });
  });

  describe('authenticateWithPassword', () => {
    it('should authenticate user with correct password', async () => {
      const userWithSave = { ...mockUserData, save: jest.fn().mockResolvedValue(mockUserData) };
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(userWithSave),
      });
      mockPasswordUtils.validatePassword.mockResolvedValue(true);

      const result = await UserService.authenticateWithPassword('test@example.com', 'password123');

      expect(result).toBeDefined();
      expect(mockPasswordUtils.validatePassword).toHaveBeenCalledWith(
        'password123',
        mockUserData.password
      );
    });

    it('should return null if password is incorrect', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUserData),
      });
      mockPasswordUtils.validatePassword.mockResolvedValue(false);

      const result = await UserService.authenticateWithPassword('test@example.com', 'wrongpassword');

      expect(result).toBeNull();
    });

    it('should return null if user not found', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const result = await UserService.authenticateWithPassword('notfound@example.com', 'password123');

      expect(result).toBeNull();
    });

    it('should throw error if email is missing', async () => {
      await expect(
        UserService.authenticateWithPassword('', 'password123')
      ).rejects.toThrow('Email is required');
    });

    it('should throw error if password is missing', async () => {
      await expect(
        UserService.authenticateWithPassword('test@example.com', '')
      ).rejects.toThrow('Password is required');
    });

    it('should update lastLoginAt on successful authentication', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUserData),
      });
      mockPasswordUtils.validatePassword.mockResolvedValue(true);

      await UserService.authenticateWithPassword('test@example.com', 'password123');

      expect(mockUserData.save).toHaveBeenCalled();
    });

    it('should throw error on database error', async () => {
      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('Database error')),
      });

      await expect(
        UserService.authenticateWithPassword('test@example.com', 'password123')
      ).rejects.toThrow('Database error while authenticating user');
    });
  });

  describe('setPassword', () => {
    it('should set password for existing user', async () => {
      const user = { ...mockUserData, isNew: false } as any;
      mockPasswordUtils.generatePasswordHash.mockResolvedValue('new-hashed-password');

      const result = await UserService.setPassword(user, 'newpassword123');

      expect(result.password).toBe('new-hashed-password');
      expect(mockPasswordUtils.generatePasswordHash).toHaveBeenCalledWith('newpassword123');
    });

    it('should not save if user is new', async () => {
      const user = { ...mockUserData, isNew: true, save: jest.fn() } as any;
      mockPasswordUtils.generatePasswordHash.mockResolvedValue('new-hashed-password');

      await UserService.setPassword(user, 'newpassword123');

      expect(user.save).not.toHaveBeenCalled();
    });

    it('should throw error if password is missing', async () => {
      await expect(
        UserService.setPassword(mockUserData as any, '')
      ).rejects.toThrow('Password is required');
    });

    it('should throw error on database error', async () => {
      const user = { ...mockUserData, save: jest.fn().mockRejectedValue(new Error('Save error')) } as any;
      mockPasswordUtils.generatePasswordHash.mockResolvedValue('new-hashed-password');

      await expect(
        UserService.setPassword(user, 'newpassword123')
      ).rejects.toThrow('Database error while setting user password');
    });
  });
});
