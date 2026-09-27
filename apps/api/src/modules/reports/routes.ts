import { Router, type Response } from 'express';
import { fileInfo, openFile } from '@ecomanage/db';
import { reportCreate, type Role } from '@ecomanage/shared';
import { handle, HttpError, parseBody, userIdOf, paramOf } from '../../lib/http';
import type { JobClient } from '../../lib/jobs';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { createReport, deleteReport, listReports, reportFile, reportLinkFile } from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Report request failed' } } };
const CONTENT_TYPE = { pdf: 'application/pdf', csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;
const roleOf = (req: AuthenticatedRequest) => req.membership!.role as Role;

const sendFile = async (res: Response, fileId: string, format: string, siteId: string) => {
  const info = await fileInfo(fileId);
  if (!info || info.metadata.siteId !== siteId) throw new HttpError(404, { error: { code: 404, message: 'Report file not found' } });
  res.setHeader('Content-Type', CONTENT_TYPE[format as keyof typeof CONTENT_TYPE]);
  res.setHeader('Content-Disposition', `attachment; filename="${info.filename}"`);
  await new Promise<void>((resolve, reject) => {
    const stream = openFile(fileId);
    stream.once('error', reject);
    stream.once('end', resolve);
    stream.pipe(res);
  });
};

// Everyone can make and read reports; removing one is for its creator or the owner (Backend
// Coverage). Installers can't include energy cost.
export default function reportsRoutes(jobs?: JobClient): Router {
  const router: Router = Router();
  const all = requireRole('owner', 'manager', 'installer');

  router.get(
    '/',
    ...all,
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      res.json(await listReports(req.site!, userIdOf(req), roleOf(req)));
    })
  );

  router.post(
    '/',
    ...all,
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      res.status(201).json(await createReport(jobs, req.site!, userIdOf(req), roleOf(req), parseBody(reportCreate, req.body)));
    })
  );

  router.get(
    '/:id/file',
    ...all,
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      const r = await reportFile(req.site!, paramOf(req, 'id'));
      await sendFile(res, r.fileId!, r.format, String(req.site!._id));
    })
  );

  router.delete(
    '/:id',
    ...all,
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      await deleteReport(jobs, req.site!, userIdOf(req), roleOf(req), paramOf(req, 'id'));
      res.status(204).end();
    })
  );

  return router;
}

/** Links in report emails (P5-01): no sign-in, the token is the key, for 30 days. */
export function reportLinkRoutes(): Router {
  const router: Router = Router();
  router.get(
    '/:token',
    handle(FALLBACK, async (req, res) => {
      const f = await reportLinkFile(paramOf(req, 'token'));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      await sendFile(res, f.fileId, f.format, f.siteId);
    })
  );
  return router;
}
