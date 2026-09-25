import { RequestHandler, Response } from 'express';
import { z } from 'zod';
import { logger } from '../config/logger';
import type { IUser } from '../modules/auth/model';
import type { AuthenticatedRequest } from '../middleware/auth';

export type JsonBody = Record<string, unknown>;

// Thrown by controllers to end a request with a specific status and body.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: JsonBody
  ) {
    super(String(body.message ?? body.error ?? status));
  }
}

type Fallback = { status: number; body: JsonBody } | ((err: Error) => { status: number; body: JsonBody });
type Controller = (req: AuthenticatedRequest, res: Response) => Promise<void>;

// Wraps a controller: HttpErrors become their response, anything else is logged and
// answered with the route's fallback (each v1 route has its own error body).
export const handle =
  (fallback: Fallback, controller: Controller): RequestHandler =>
  async (req, res) => {
    try {
      await controller(req, res);
    } catch (e) {
      if (e instanceof HttpError) {
        res.status(e.status).json(e.body);
        return;
      }
      const err = e instanceof Error ? e : new Error(String(e));
      logger.error({ err: err.message, path: req.originalUrl.split('?')[0] }, 'request failed');
      const { status, body } = typeof fallback === 'function' ? fallback(err) : fallback;
      res.status(status).json(body);
    }
  };

export const parse = <S extends z.ZodTypeAny>(schema: S, data: unknown, status: number, body: JsonBody): z.infer<S> => {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(status, body);
  return result.data;
};

// requireUser runs before every controller that calls this, so the 401 is a safety net.
export const currentUser = (req: AuthenticatedRequest): IUser => {
  if (!req.user) throw new HttpError(401, { error: 'Unauthorized' });
  return req.user;
};

export const userIdOf = (req: AuthenticatedRequest): string => String(currentUser(req)._id);

/** Parses a v2 request body: zod errors become 400 with each field's message in details.issues. */
export const parseBody = <S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> => {
  const r = schema.safeParse(data);
  if (!r.success)
    throw new HttpError(400, {
      error: {
        code: 400,
        message: r.error.issues[0]?.message ?? 'Invalid request',
        details: { issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      },
    });
  return r.data;
};
