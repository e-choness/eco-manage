import { parentPort, workerData } from 'node:worker_threads';
import { convertModel, type InputFormat } from './pipeline';
import { Rejected, systemTools } from './tools';

// One conversion, in its own thread (see isolate.ts).

const { input, format, toktx } = workerData as { input: Uint8Array; format: InputFormat; toktx: boolean };

convertModel(input, format, systemTools({ toktx })).then(
  (result) => parentPort!.postMessage({ ok: true, result }),
  (err: Error) => parentPort!.postMessage({ ok: false, rejected: err instanceof Rejected, message: err.message })
);
