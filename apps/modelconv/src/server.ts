import { createServer, type IncomingMessage } from 'node:http';
import { convertIsolated } from './isolate';
import type { InputFormat } from './pipeline';
import { Rejected } from './tools';

// The sandboxed converter (P5-02). It has no database, storage or internet access: the worker
// posts one file and gets back the GLB, the thumbnail and what was done, or a reason the file
// can't be used. One conversion at a time; each is limited in time and size.
//
// POST /convert   headers: x-format (glb, gltf, obj, fbx, ifc); body: the file
//   200 { glb, thumbnail (base64), stats }   422 { reason }   500 { error }
// GET  /health

const PORT = Number(process.env.PORT ?? 3100);
const MAX_BYTES = 30 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = Number(process.env.CONVERT_TIMEOUT_MS ?? 240_000);
const FORMATS: InputFormat[] = ['glb', 'gltf', 'obj', 'fbx', 'ifc'];
const TOKTX = process.env.KTX2 !== 'off';

const readBody = (req: IncomingMessage): Promise<Buffer | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES) {
        resolve(null);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

let queue: Promise<unknown> = Promise.resolve();
/** One at a time: conversions are heavy, and the container is small. */
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
};

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/health') return send(200, { status: 'up' });
  if (req.method !== 'POST' || req.url !== '/convert') return send(404, { error: 'not found' });
  const format = String(req.headers['x-format'] ?? '') as InputFormat;
  if (!FORMATS.includes(format)) return send(400, { error: `x-format must be one of ${FORMATS.join(', ')}` });
  const body = await readBody(req);
  if (!body) return send(413, { reason: 'The file is over 30 MB.' });
  const started = Date.now();
  try {
    const out = await serial(() => convertIsolated(new Uint8Array(body), format, { toktx: TOKTX, timeoutMs: CONVERT_TIMEOUT_MS }));
    console.log(JSON.stringify({ msg: 'converted', format, bytes: body.length, ms: Date.now() - started, ...out.stats }));
    send(200, { glb: Buffer.from(out.glb).toString('base64'), thumbnail: out.thumbnail.toString('base64'), stats: out.stats });
  } catch (err) {
    if (err instanceof Rejected) {
      console.log(JSON.stringify({ msg: 'rejected', format, bytes: body.length, reason: err.message }));
      return send(422, { reason: err.message });
    }
    console.error(JSON.stringify({ msg: 'failed', format, err: (err as Error).message }));
    send(500, { error: (err as Error).message });
  }
});

server.requestTimeout = CONVERT_TIMEOUT_MS + 60_000;
server.listen(PORT, () => console.log(JSON.stringify({ msg: 'modelconv ready', port: PORT })));
