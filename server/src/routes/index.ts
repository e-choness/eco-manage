import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.status(200).json({ message: 'Welcome to EcoManage API!' });
});

router.get('/ping', (req: Request, res: Response) => {
  res.status(200).json({ message: 'pong' });
});

export default router;
