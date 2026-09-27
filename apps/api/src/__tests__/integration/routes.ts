import express, { type Express } from 'express';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name: string;
  handle: { stack?: Layer[] };
}

// Express 5 keeps no mount path on a router's layer, so the paths routers are mounted at are
// recorded as they are mounted (this module is imported before any app is created).
const mounts = new WeakMap<object, string>();
const recording = (use: (...args: unknown[]) => unknown) =>
  function (this: unknown, ...args: unknown[]) {
    if (typeof args[0] === 'string') for (const fn of args.slice(1).flat()) if (typeof fn === 'function') mounts.set(fn, args[0] === '/' ? '' : args[0]);
    return use.apply(this, args);
  };
const app = express.application as unknown as { use: (...args: unknown[]) => unknown };
app.use = recording(app.use);
const routerProto = (express.Router as unknown as { prototype: { use: (...args: unknown[]) => unknown } }).prototype;
routerProto.use = recording(routerProto.use);

/** Lists "method /path" for every route registered on the app, including mounted routers. */
export const listRoutes = (target: Express): string[] => {
  const out: string[] = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) out.push(`${m} ${prefix}${layer.route.path}`);
      } else if (layer.name === 'router' && layer.handle.stack) {
        walk(layer.handle.stack, prefix + (mounts.get(layer.handle) ?? ''));
      }
    }
  };
  walk((target as unknown as { router: { stack: Layer[] } }).router.stack, '');
  return out;
};
