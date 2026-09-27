/**
 * Database Configuration Tests
 *
 * Tests for MongoDB connection configuration
 */

import mongoose from 'mongoose';
import { initModels } from '@ecomanage/db';
import { connectDB } from '../../config/database';

// A plain stand-in for mongoose: its `connection` is replaced per test.
vi.mock('mongoose', () => ({ default: { connect: vi.fn(), connection: {} } }));
// Collections and indexes are made after connecting (Mongoose's automatic creation is off).
vi.mock('@ecomanage/db', () => ({ initModels: vi.fn(async () => undefined) }));

const mockMongoose = vi.mocked(mongoose) as unknown as { connect: ReturnType<typeof vi.fn>; connection: unknown };
const connectionWith = (on = vi.fn()) => ({ on, close: vi.fn(async () => undefined) });

describe('Database Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'mongodb://test:27017/testdb';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('connectDB', () => {
    it('should attempt to connect to MongoDB with DATABASE_URL, then make the collections', async () => {
      mockMongoose.connect.mockResolvedValue({ connection: { host: 'localhost' } });
      mockMongoose.connection = connectionWith();

      await connectDB();

      expect(mockMongoose.connect).toHaveBeenCalledWith('mongodb://test:27017/testdb');
      expect(initModels).toHaveBeenCalledTimes(1);
    });

    it('should log successful connection', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      mockMongoose.connect.mockResolvedValue({ connection: { host: 'mongodb-server' } });
      mockMongoose.connection = connectionWith();

      await connectDB();

      expect(consoleLogSpy).toHaveBeenCalledWith('MongoDB Connected: mongodb-server');
    });

    it('should handle connection errors and exit', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      mockMongoose.connect.mockRejectedValue(new Error('Connection failed'));

      await connectDB();

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should set up event listeners for connection', async () => {
      const onMock = vi.fn();
      mockMongoose.connect.mockResolvedValue({ connection: { host: 'localhost' } });
      mockMongoose.connection = connectionWith(onMock);

      await connectDB();

      // Verify that event listeners were attached
      expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));
      expect(onMock).toHaveBeenCalledWith('disconnected', expect.any(Function));
      expect(onMock).toHaveBeenCalledWith('reconnected', expect.any(Function));
    });
  });
});
