import type { Express } from 'express';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name: string;
  regexp: RegExp;
  handle: { stack?: Layer[] };
}

/** Lists "method /path" for every route registered on the app, including mounted routers. */
export const listRoutes = (app: Express): string[] => {
  const out: string[] = [];
  const mountOf = (re: RegExp) =>
    re.source === '^\\/?(?=\\/|$)' ? '' : re.source.replace('^\\', '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) out.push(`${m} ${prefix}${layer.route.path}`);
      } else if (layer.name === 'router' && layer.handle.stack) {
        walk(layer.handle.stack, prefix + mountOf(layer.regexp));
      }
    }
  };
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack, '');
  return out;
};
