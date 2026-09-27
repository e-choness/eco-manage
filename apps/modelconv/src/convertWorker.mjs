// Worker-thread entry: Node doesn't apply `--import tsx` to a worker's first module, so this
// registers tsx and then loads the TypeScript worker.
import { register } from 'tsx/esm/api';

register();
await import('./convertWorker.ts');
