import { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE = 'em_rt';
const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const refreshCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth',
});

export const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(REFRESH_COOKIE, token, { ...refreshCookieOptions(), maxAge: REFRESH_MAX_AGE_MS });
};

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
};

export const readCookie = (req: Request, name: string): string | undefined => {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
};
