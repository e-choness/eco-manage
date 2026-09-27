import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { MODEL_MAX_BYTES } from '@ecomanage/shared';
import { handle, userIdOf, paramOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { createUpload, deleteUpload, getUpload, listUploads, useUpload, type UploadDeps } from './service';

// /api/site/model/uploads (P5-02): owners and installers edit the site model (Data and Device
// Audit §6); everyone else can see the list.

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Model upload request failed' } } };

/** One `file` field in memory; over 30 MB is refused with the reason (413). */
const modelFile: RequestHandler = (req, res, next) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: MODEL_MAX_BYTES, files: 1 } }).single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({
      error: { code: tooBig ? 413 : 400, message: tooBig ? 'The file is over 30 MB. Reduce textures or detail in your modelling tool, or export as .glb.' : 'Invalid upload' },
    });
  });

export default function modelUploadRoutes(deps: UploadDeps): Router {
  const router: Router = Router();
  const editors = requireRole('owner', 'installer');

  router.get(
    '/',
    ...requireRole('owner', 'manager', 'installer'),
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      res.json(await listUploads(req.site!));
    })
  );

  router.post(
    '/',
    ...editors,
    modelFile,
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      res.status(202).json(await createUpload(deps, req.site!, userIdOf(req), req.file));
    })
  );

  router.get(
    '/:id',
    ...requireRole('owner', 'manager', 'installer'),
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      res.json(await getUpload(req.site!, paramOf(req, 'id')));
    })
  );

  router.post(
    '/:id/use',
    ...editors,
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      res.json(await useUpload(req.site!, userIdOf(req), paramOf(req, 'id')));
    })
  );

  router.delete(
    '/:id',
    ...editors,
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      await deleteUpload(deps, req.site!, userIdOf(req), paramOf(req, 'id'));
      res.status(204).end();
    })
  );

  return router;
}
