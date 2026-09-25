import type { RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { handle, HttpError, parse, userIdOf } from '../../lib/http';
import type { JobClient } from '../../lib/jobs';
import type { AuthenticatedRequest } from '../../middleware/auth';
import * as bills from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Bill request failed' } } };
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const siteOf = (req: AuthenticatedRequest) => req.site!;
const bad = (message: string) => ({ error: { code: 400, message } });

const periodParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), 'invalid date');
const rangeQuery = z.object({ from: localDate, to: localDate });
const manualTotal = z.object({ totalCents: z.number().int().min(0).max(1e10) });

const periodOf = (req: AuthenticatedRequest) => parse(periodParam, req.params.period, 400, bad('Period must be YYYY-MM'));

/** Multer in memory, one `file` field; oversize → 413, other multipart errors → 400. */
export const utilityUpload: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }).single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: { code: tooBig ? 413 : 400, message: tooBig ? 'The file is larger than 10 MB' : 'Invalid upload' } });
  });
};

export const billsController = (jobs?: JobClient) => ({
  list: handle(FALLBACK, async (req, res) => {
    res.json(await bills.listBills(siteOf(req)));
  }),

  range: handle(FALLBACK, async (req, res) => {
    const q = parse(rangeQuery, req.query, 400, bad('`from` and `to` must be dates (YYYY-MM-DD)'));
    res.json(await bills.rangeSpend(siteOf(req), q.from, q.to));
  }),

  detail: handle(FALLBACK, async (req, res) => {
    res.json(await bills.billDetail(siteOf(req), periodOf(req)));
  }),

  statement: handle(FALLBACK, async (req, res) => {
    const { filename, stream } = await bills.statement(siteOf(req), periodOf(req), jobs);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject);
      stream.once('end', resolve);
      stream.pipe(res);
    });
  }),

  // A file (multipart `file`) is read by the worker: 202. A JSON {totalCents} is stored as typed: 200.
  utilityBill: handle(FALLBACK, async (req, res) => {
    const period = periodOf(req);
    const file = (req as AuthenticatedRequest & { file?: bills.UploadedFile }).file;
    if (file) {
      res.status(202).json({ utility: await bills.uploadUtilityBill(siteOf(req), userIdOf(req), period, file, jobs) });
      return;
    }
    if (req.is('multipart/form-data')) throw new HttpError(400, bad('Attach the bill as `file`'));
    const { totalCents } = parse(manualTotal, req.body, 400, bad('Send a file, or {"totalCents": <whole cents>}'));
    res.json({ utility: await bills.enterUtilityTotal(siteOf(req), userIdOf(req), period, totalCents) });
  }),
});
