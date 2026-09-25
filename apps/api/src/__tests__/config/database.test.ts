/**
 * Database Configuration Tests
 *
 * Tests for MongoDB connection configuration
 */

import mongoose from 'mongoose';
import { connectDB } from '../../config/database';

jest.mock('mongoose');

const mockMongoose = mongoose as jest.Mocked<typeof mongoose>;

describe('Database Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'mongodb://test:27017/testdb';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('connectDB', () => {
    it('should attempt to connect to MongoDB with DATABASE_URL', async () => {
      const mockConnection = {
        connection: {
          host: 'localhost',
        },
      };

      mockMongoose.connect.mockResolvedValue(mockConnection as any);
      (mockMongoose.connection as any) = {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };

      await connectDB();

      expect(mockMongoose.connect).toHaveBeenCalledWith('mongodb://test:27017/testdb');
    });

    it('should log successful connection', async () => {
      const mockConnection = {
        connection: {
          host: 'mongodb-server',
        },
      };

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      mockMongoose.connect.mockResolvedValue(mockConnection as any);
      (mockMongoose.connection as any) = {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };

      await connectDB();

      expect(consoleLogSpy).toHaveBeenCalledWith('MongoDB Connected: mongodb-server');

      consoleLogSpy.mockRestore();
    });

    it('should handle connection errors and exit', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      mockMongoose.connect.mockRejectedValue(new Error('Connection failed'));

      await connectDB();

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);

      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should set up event listeners for connection', async () => {
      const mockConnection = {
        connection: {
          host: 'localhost',
        },
      };

      const onMock = jest.fn();
      mockMongoose.connect.mockResolvedValue(mockConnection as any);
      (mockMongoose.connection as any) = {
        on: onMock,
        close: jest.fn().mockResolvedValue(undefined),
      };

      await connectDB();

      // Verify that event listeners were attached
      expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));
      expect(onMock).toHaveBeenCalledWith('disconnected', expect.any(Function));
      expect(onMock).toHaveBeenCalledWith('reconnected', expect.any(Function));
    });
  });
});
