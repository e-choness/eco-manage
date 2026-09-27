import { Worker } from 'node:worker_threads';
import type { ConvertResult, InputFormat } from './pipeline';
import { Rejected } from './tools';

// Each conversion runs in its own worker thread (P5-02): a file that makes a library crash or
// run away takes down only its own conversion, memory is capped, and a timeout really stops it.

const CRASHED = 'The file couldn’t be read as a 3D model. Check that it opens in your modelling tool, then export it again (as .glb if you can).';

export const convertIsolated = (input: Uint8Array, format: InputFormat, opts: { toktx: boolean; timeoutMs: number; memoryMb?: number }): Promise<ConvertResult> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./convertWorker.mjs', import.meta.url), {
      workerData: { input, format, toktx: opts.toktx },
      resourceLimits: { maxOldGenerationSizeMb: opts.memoryMb ?? 2048 },
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Rejected('Processing the model took too long. Simplify it or export it as .glb.'))), opts.timeoutMs);
    worker.once('message', (m: { ok: true; result: ConvertResult } | { ok: false; rejected: boolean; message: string }) =>
      finish(() => {
        if (m.ok) resolve({ ...m.result, glb: new Uint8Array(m.result.glb), thumbnail: Buffer.from(m.result.thumbnail) });
        else reject(m.rejected ? new Rejected(m.message) : new Error(m.message));
      })
    );
    // An uncaught error inside the thread, or running out of memory: the file is the likely cause.
    worker.once('error', (err) =>
      finish(() => {
        console.error(JSON.stringify({ msg: 'conversion crashed', format, err: err.message }));
        reject(new Rejected(/heap|memory/i.test(err.message) ? 'The model is too big to process. Reduce detail in your modelling tool, or export it as .glb.' : CRASHED));
      })
    );
    worker.once('exit', (code) => finish(() => reject(new Rejected(code ? CRASHED : 'The conversion stopped unexpectedly.'))));
  });
