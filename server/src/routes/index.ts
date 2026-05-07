import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ message: 'Welcome to EcoManage API!' });
});

router.get('/ping', (_req: Request, res: Response) => {
  res.status(200).json({ message: 'pong' });
});

export default router;
