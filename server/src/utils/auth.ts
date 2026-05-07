import jwt from 'jsonwebtoken';
import { IUser } from '../models/User';

export interface TokenPayload {
  sub: string;
  iat?: number;
  exp?: number;
}

export const generateAccessToken = (user: IUser): string => {
  const payload: TokenPayload = {
    sub: (user._id as any).toString(),
  };
  return jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: '1d' });
};

export const generateRefreshToken = (user: IUser): string => {
  const payload: TokenPayload = {
    sub: (user._id as any).toString(),
  };
  return jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET as string, { expiresIn: '30d' });
};

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, process.env.JWT_SECRET as string) as TokenPayload;
};

export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET as string) as TokenPayload;
};
