import { Request, Response } from 'express';

export const welcome = (_req: Request, res: Response): void => {
  res.status(200).json({ message: 'Welcome to EcoManage API!' });
};

export const ping = (_req: Request, res: Response): void => {
  res.status(200).json({ message: 'pong' });
};
