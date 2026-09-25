import mongoose from 'mongoose';

export const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(process.env.DATABASE_URL as string);

    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Error handling after initial connection
    mongoose.connection.on('error', (err: Error) => {
      console.error(`MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.info('MongoDB reconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        console.log('MongoDB connection closed through app termination');
        process.exit(0);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`Error during MongoDB shutdown: ${error.message}`);
        process.exit(1);
      }
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
};
