import { Router } from 'express';
import { fileInfo, openFile } from '@ecomanage/db';
import { reportCreate, type Role } from '@ecomanage/shared';
import { handle, HttpError, parseBody, userIdOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { createReport, deleteReport, listReports, reportFile } from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Report request failed' } } };
const CONTENT_TYPE = { pdf: 'application/pdf', csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;
const roleOf = (req: AuthenticatedRequest) => req.membership!.role as Role;

// Everyone can make and read reports; removing one is for its creator or the owner (Backend
// Coverage). Installers can't include energy cost.
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
    res.status(201).json(await createReport(req.site!, userIdOf(req), roleOf(req), parseBody(reportCreate, req.body)));
  })
);

router.get(
  '/:id/file',
  ...all,
  handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
    const r = await reportFile(req.site!, req.params.id);
    const info = await fileInfo(r.fileId!);
    if (!info || info.metadata.siteId !== String(req.site!._id)) throw new HttpError(404, { error: { code: 404, message: 'Report file not found' } });
    res.setHeader('Content-Type', CONTENT_TYPE[r.format as keyof typeof CONTENT_TYPE]);
    res.setHeader('Content-Disposition', `attachment; filename="${info.filename}"`);
    await new Promise<void>((resolve, reject) => {
      const stream = openFile(r.fileId!);
      stream.once('error', reject);
      stream.once('end', resolve);
      stream.pipe(res);
    });
  })
);

router.delete(
  '/:id',
  ...all,
  handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
    await deleteReport(req.site!, userIdOf(req), roleOf(req), req.params.id);
    res.status(204).end();
  })
);

export default router;
