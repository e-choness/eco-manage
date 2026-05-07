import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/database.js';
import basicRoutes from './routes/index.js';
import authRoutes from './routes/authRoutes.js';

dotenv.config();

// Validate environment variables
if (!process.env.DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is missing.');
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.enable('json spaces');
app.enable('strict routing');
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
connectDB();

// Global error handler for unhandled Promise rejections
process.on('unhandledRejection', (err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(`Unhandled Rejection: ${error.message}`);
  console.error(error.stack);
});

// Routes
app.use(basicRoutes);
app.use('/api/auth', authRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Page not found.' });
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`Application error: ${err.message}`);
  console.error(err.stack);
  res.status(500).json({ message: 'There was an error serving your request.' });
});

// Start server
const server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nGraceful shutdown initiated...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});
