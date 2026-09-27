import { Router } from 'express';
import { exportCreate, type Role } from '@ecomanage/shared';
import { handle, parseBody, userIdOf, paramOf } from '../../lib/http';
import type { JobClient } from '../../lib/jobs';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { createExport, exportFile, getExport } from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Export request failed' } } };

// Everyone can export history; installers get no cost columns (Backend Coverage).
export const exportsRoutes = (jobs?: JobClient): Router => {
  const router: Router = Router();
  const all = requireRole('owner', 'manager', 'installer');

  router.post(
    '/',
    ...all,
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      res.status(202).json(await createExport(jobs, req.site!, userIdOf(req), req.membership!.role as Role, parseBody(exportCreate, req.body)));
    })
  );

  router.get(
    '/:id',
    ...all,
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      res.json(await getExport(req.site!, paramOf(req, 'id')));
    })
  );

  router.get(
    '/:id/file',
    ...all,
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      const { filename, stream } = await exportFile(req.site!, paramOf(req, 'id'));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await new Promise<void>((resolve, reject) => {
        stream.once('error', reject);
        stream.once('end', resolve);
        stream.pipe(res);
      });
    })
  );

  return router;
};
