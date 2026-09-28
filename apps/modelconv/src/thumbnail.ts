import type { Document } from '@gltf-transform/core';
import { PNG } from 'pngjs';

// Thumbnail of the processed model (P5-02): an isometric view drawn in software, so the sandbox
// needs no GPU or browser. Flat shading from each triangle's normal, colours from the materials'
// base colour (textures are left out), a transparent background, 2× supersampled.

const W = 480;
const H = 320;
const SS = 2;

type V3 = [number, number, number];

const mul = (m: number[], p: V3): V3 => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

interface Tri {
  p: [V3, V3, V3];
  rgb: V3;
}

/** Every triangle in world space with its material colour. */
const worldTriangles = (doc: Document): Tri[] => {
  const tris: Tri[] = [];
  for (const scene of doc.getRoot().listScenes())
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const m = node.getWorldMatrix() as unknown as number[];
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4) continue; // triangles only
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const idx = prim.getIndices();
        const n = idx ? idx.getCount() : pos.getCount();
        const f = prim.getMaterial()?.getBaseColorFactor() ?? [0.8, 0.8, 0.8, 1];
        const rgb: V3 = [f[0], f[1], f[2]];
        const at = (i: number) => mul(m, pos.getElement(idx ? idx.getScalar(i) : i, [0, 0, 0]) as V3);
        for (let i = 0; i + 2 < n; i += 3) tris.push({ p: [at(i), at(i + 1), at(i + 2)], rgb });
      }
    });
  return tris;
};

/** A PNG of the model from above and to the side, like Home's default view. */
export const renderThumbnail = (doc: Document): Buffer => {
  const tris = worldTriangles(doc);
  const w = W * SS;
  const h = H * SS;
  // Camera looking down at the model from the south-east, orthographic.
  const eye = norm([1, 0.9, 1.2]);
  const right = norm(cross([0, 1, 0], eye));
  const up = cross(eye, right);
  const light = norm([0.4, 1, 0.6]);
  const project = (p: V3): V3 => [dot(p, right), dot(p, up), dot(p, eye)];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const projected = tris.map((t) => {
    const q = t.p.map(project) as [V3, V3, V3];
    for (const v of q) {
      minX = Math.min(minX, v[0]);
      maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]);
      maxY = Math.max(maxY, v[1]);
    }
    return q;
  });
  const scale = tris.length ? 0.9 * Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1)) : 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const toScreen = (v: V3): V3 => [w / 2 + (v[0] - cx) * scale, h / 2 - (v[1] - cy) * scale, v[2]];

  const depth = new Float32Array(w * h).fill(-Infinity);
  const colour = new Uint8Array(w * h * 4);
  tris.forEach((t, k) => {
    const normal = norm(cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0])));
    // Two-sided: light the face that points at the camera.
    const facing = dot(normal, eye) < 0 ? ([-normal[0], -normal[1], -normal[2]] as V3) : normal;
    const shade = 0.35 + 0.65 * Math.max(0, dot(facing, light));
    const [a, b, c] = projected[k].map(toScreen);
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (!area) return;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const i = y * w + x;
        if (z <= depth[i]) continue;
        depth[i] = z;
        colour[i * 4] = Math.min(255, t.rgb[0] * shade * 255);
        colour[i * 4 + 1] = Math.min(255, t.rgb[1] * shade * 255);
        colour[i * 4 + 2] = Math.min(255, t.rgb[2] * shade * 255);
        colour[i * 4 + 3] = 255;
      }
  });

  // Box-filter down to the final size (premultiplied, so edges blend into the transparent background).
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * w + x * SS + sx) * 4;
          const al = colour[i + 3] / 255;
          r += colour[i] * al;
          g += colour[i + 1] * al;
          b += colour[i + 2] * al;
          a += al;
        }
      const o = (y * W + x) * 4;
      png.data[o] = a ? r / a : 0;
      png.data[o + 1] = a ? g / a : 0;
      png.data[o + 2] = a ? b / a : 0;
      png.data[o + 3] = (a / (SS * SS)) * 255;
    }
  return PNG.sync.write(png);
};
