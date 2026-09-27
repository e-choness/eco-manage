import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The converter's command-line tools (P5-02). Each runs with a time limit, no shell and its
// input in a fresh temporary folder that is removed afterwards.

export class Rejected extends Error {}

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_TIMEOUT_MS = Number(process.env.TOOL_TIMEOUT_MS ?? 120_000);

export const run = (cmd: string, args: string[], timeoutMs = TOOL_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        // The tool's own error line when it printed one (assimp: "ERROR: …"), never our paths.
        const said = /ERROR:\s*(.+)/.exec(`${stdout}\n${stderr}`)?.[1] ?? stderr.trim().split('\n').pop();
        const detail = (said ?? '').replace(/\/tmp\/modelconv-\w+\//g, '').trim() || 'it stopped without saying why';
        reject(Object.assign(new Error(e.killed ? `${cmd} took longer than ${timeoutMs / 1000} s` : `${cmd} failed: ${detail}`), { code: e.code, killed: e.killed }));
      } else resolve({ stdout, stderr });
    });
  });

export const withTemp = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), 'modelconv-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export interface Tools {
  /** OBJ or FBX to GLB (assimp). */
  toGlb(input: Buffer, format: 'obj' | 'fbx'): Promise<Buffer>;
  /** IFC to GLB: IfcOpenShell tessellates it into OBJ (metres, Y-up), then assimp. */
  ifcToGlb(input: Buffer): Promise<Buffer>;
  /** PNG or JPEG to KTX2 (Basis Universal); null when toktx isn't installed. */
  toKtx2: ((image: Uint8Array, mimeType: string, opts: { normalMap: boolean; resize: [number, number] | null }) => Promise<Uint8Array>) | null;
}

const assimp = async (dir: string, input: string): Promise<Buffer> => {
  const out = join(dir, 'out.glb');
  try {
    await run('assimp', ['export', input, out, '-fglb2', '-tri', '-gsn', '-jiv']);
  } catch (err) {
    if ((err as { killed?: boolean }).killed) throw new Rejected('Converting the file took too long. Simplify it in your modelling tool, or export it as .glb.');
    throw new Rejected(`The file couldn’t be converted: ${(err as Error).message.replace(/^assimp failed: /, '')}`);
  }
  return readFile(out);
};

export const systemTools = (opts: { toktx: boolean } = { toktx: true }): Tools => ({
  toGlb: (input, format) =>
    withTemp(async (dir) => {
      const file = join(dir, `in.${format}`);
      await writeFile(file, input);
      return assimp(dir, file);
    }),
  ifcToGlb: (input) =>
    withTemp(async (dir) => {
      const ifc = join(dir, 'in.ifc');
      const obj = join(dir, 'in.obj');
      await writeFile(ifc, input);
      try {
        await run('python3', [join(HERE, 'ifc2obj.py'), ifc, obj]);
      } catch (err) {
        const msg = (err as Error).message;
        if ((err as { killed?: boolean }).killed) throw new Rejected('Reading the IFC file took too long. Export a smaller part of the building, or a .glb.');
        throw new Rejected(/no geometry/i.test(msg) ? 'The IFC file has no building elements with geometry.' : `The IFC file couldn’t be read: ${msg.replace(/^python3 failed: /, '')}`);
      }
      return assimp(dir, obj);
    }),
  toKtx2: opts.toktx
    ? (image, mimeType, { normalMap, resize }) =>
        withTemp(async (dir) => {
          const input = join(dir, mimeType === 'image/png' ? 'in.png' : 'in.jpg');
          const output = join(dir, 'out.ktx2');
          await writeFile(input, image);
          const mode = normalMap
            ? ['--encode', 'uastc', '--uastc_quality', '2', '--zcmp', '18', '--assign_oetf', 'linear']
            : ['--encode', 'etc1s', '--clevel', '1', '--qlevel', '128'];
          await run('toktx', ['--t2', ...mode, '--genmipmap', ...(resize ? ['--resize', `${resize[0]}x${resize[1]}`] : []), output, input]);
          return new Uint8Array(await readFile(output));
        })
    : null,
});
