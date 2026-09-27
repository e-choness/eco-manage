import { Document, ImageUtils, NodeIO, getBounds, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import { center, dedup, prune, simplify, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import validator from 'gltf-validator';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { renderThumbnail } from './thumbnail';
import { Rejected, type Tools } from './tools';

// One upload in, one GLB out (P5-02, Data and Device Audit §6): metres, Y-up, centred on the
// origin with its base at y = 0, under 200k triangles, textures 2048 px or smaller as KTX2,
// meshes Draco-compressed, and a PNG thumbnail. A file we can't use is Rejected with a reason
// the uploader can act on.

export const TRIANGLE_LIMIT = 200_000;
export const TEXTURE_MAX_PX = 2048;
const MAX_EXTENT_M = 2000; // bigger than any school campus: the units are wrong
const MIN_EXTENT_M = 0.05;

export type InputFormat = 'glb' | 'gltf' | 'obj' | 'fbx' | 'ifc';

export interface ConvertResult {
  glb: Uint8Array;
  thumbnail: Buffer;
  stats: {
    trisIn: number;
    tris: number;
    bbox: { min: [number, number, number]; max: [number, number, number] };
    scale: number;
    textures: number;
    ktx2: boolean;
  };
}

let io: NodeIO | null = null;
const getIO = async (): Promise<NodeIO> => {
  if (io) return io;
  await MeshoptDecoder.ready;
  await MeshoptSimplifier.ready;
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'meshopt.decoder': MeshoptDecoder,
  });
  return io;
};

/** Triangles drawn by the document (lines and points don't count). */
export const countTriangles = (doc: Document): number => {
  let n = 0;
  // Per node, so a mesh placed several times counts each time it is drawn.
  for (const scene of doc.getRoot().listScenes())
    scene.traverse((node) => {
      for (const prim of node.getMesh()?.listPrimitives() ?? []) {
        const count = prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0;
        const mode = prim.getMode();
        if (mode === 4) n += Math.floor(count / 3);
        else if (mode === 5 || mode === 6) n += Math.max(0, count - 2);
      }
    });
  return n;
};

/** The GLB container itself (header, JSON chunk), before any library parses it. */
export const glbContainerProblem = (b: Uint8Array): string | null => {
  const damaged = (what: string) => `This .glb is damaged (${what}). Export it again from your modelling tool.`;
  if (b.length < 20) return damaged('it is too short');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint32(0, true) !== 0x46546c67) return damaged('no glTF header');
  if (v.getUint32(4, true) !== 2) return `This .glb is glTF version ${v.getUint32(4, true)}; only glTF 2.0 is supported.`;
  if (v.getUint32(8, true) > b.length) return damaged('it is shorter than its header says');
  const jsonLength = v.getUint32(12, true);
  if (v.getUint32(16, true) !== 0x4e4f534a || jsonLength === 0 || 20 + jsonLength > b.length) return damaged('its JSON part is missing');
  try {
    JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jsonLength)));
  } catch {
    return damaged('its JSON part can’t be read');
  }
  return null;
};

const validate = async (bytes: Uint8Array): Promise<void> => {
  const report = await validator.validateBytes(bytes, { maxIssues: 10, externalResourceFunction: () => Promise.reject(new Error('external resources are not allowed')) });
  const errors = (report.issues?.messages ?? []).filter((m: { severity: number }) => m.severity === 0);
  if (errors.length)
    throw new Rejected(`The glTF file has errors: ${errors.slice(0, 3).map((e: { message: string; pointer?: string }) => `${e.message}${e.pointer ? ` (${e.pointer})` : ''}`).join('; ')}`);
};

const extentOf = (doc: Document) => {
  const b = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
  return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
};

/** cm and mm exports are common; a site is between a few metres and a couple of kilometres. */
const unitScale = (extent: number) => (extent > MAX_EXTENT_M * 10 ? 0.001 : extent > MAX_EXTENT_M ? 0.01 : 1);

const applyScale = (doc: Document, s: number) => {
  if (s === 1) return;
  for (const scene of doc.getRoot().listScenes())
    for (const node of scene.listChildren()) {
      const t = node.getTranslation();
      const k = node.getScale();
      node.setTranslation([t[0] * s, t[1] * s, t[2] * s]).setScale([k[0] * s, k[1] * s, k[2] * s]);
    }
};

/**
 * The size a texture is compressed at: at most 2048 px on its longer side, and both sides a
 * multiple of 4 (ETC1S and UASTC work in 4×4 blocks; GPUs reject other sizes). Null: keep it.
 */
export const ktx2Size = ([w, h]: [number, number]): [number, number] | null => {
  const s = Math.min(1, TEXTURE_MAX_PX / Math.max(w, h));
  const to = (x: number) => Math.min(TEXTURE_MAX_PX, Math.max(4, Math.round((x * s) / 4) * 4));
  const out: [number, number] = [to(w), to(h)];
  return out[0] === w && out[1] === h ? null : out;
};

const compressTextures = async (doc: Document, tools: Tools): Promise<boolean> => {
  const textures = doc.getRoot().listTextures();
  if (!textures.length) return false;
  const normalMaps = new Set<Texture>(doc.getRoot().listMaterials().map((m) => m.getNormalTexture()).filter((t): t is Texture => !!t));
  let converted = false;
  for (const texture of textures) {
    const mime = texture.getMimeType();
    const image = texture.getImage();
    if (!image || (mime !== 'image/png' && mime !== 'image/jpeg')) continue;
    const size = ImageUtils.getSize(image, mime);
    const big = size ? Math.max(size[0], size[1]) : 0;
    if (!tools.toKtx2) {
      if (big > TEXTURE_MAX_PX) throw new Rejected(`A texture is ${size![0]}×${size![1]} px; the limit is ${TEXTURE_MAX_PX} px. Resize it in your modelling tool.`);
      continue;
    }
    const resize = size ? ktx2Size(size) : null;
    texture.setImage(await tools.toKtx2(image, mime, { normalMap: normalMaps.has(texture), resize })).setMimeType('image/ktx2');
    const uri = texture.getURI();
    if (uri) texture.setURI(uri.replace(/\.(png|jpe?g)$/i, '.ktx2'));
    converted = true;
  }
  if (converted) doc.createExtension(KHRTextureBasisu).setRequired(true);
  return converted;
};

export const convertModel = async (input: Uint8Array, format: InputFormat, tools: Tools): Promise<ConvertResult> => {
  let glb: Uint8Array;
  if (format === 'glb' || format === 'gltf') {
    const damaged = format === 'glb' ? glbContainerProblem(input) : null;
    if (damaged) throw new Rejected(damaged);
    await validate(input);
    glb = input;
  } else if (format === 'ifc') glb = await tools.ifcToGlb(Buffer.from(input));
  else glb = await tools.toGlb(Buffer.from(input), format);

  const io = await getIO();
  let doc: Document;
  try {
    doc = format === 'gltf' ? await io.readJSON({ json: JSON.parse(new TextDecoder().decode(glb)), resources: {} }) : await io.readBinary(glb);
  } catch (err) {
    throw new Rejected(`The model couldn’t be read: ${(err as Error).message}`);
  }
  // Decoded on read; written again with Draco below.
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression' || ext.extensionName === 'KHR_draco_mesh_compression') ext.dispose();
  if (!doc.getRoot().listScenes().length) throw new Rejected('The file has no scene to show.');

  const trisIn = countTriangles(doc);
  if (!trisIn) throw new Rejected('The model has no surfaces (no triangles). Export the building’s geometry, not only lines or points.');

  const scale = unitScale(extentOf(doc));
  applyScale(doc, scale);
  const extent = extentOf(doc);
  if (!Number.isFinite(extent) || extent > MAX_EXTENT_M) throw new Rejected(`The model is about ${(extent / 1000).toFixed(1)} km across. Export it in metres with the site near the origin.`);
  if (extent < MIN_EXTENT_M) throw new Rejected(`The model is only ${(extent * 100).toFixed(1)} cm across. Export it in metres.`);

  await doc.transform(dedup(), prune(), weld(), center({ pivot: 'below' }));

  // Simplify in passes, allowing a little more error each time, until under the limit.
  let tris = countTriangles(doc);
  for (let pass = 0, error = 0.001; tris > TRIANGLE_LIMIT && pass < 5; pass++, error *= 4) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: (TRIANGLE_LIMIT * 0.95) / tris, error, lockBorder: false }), prune());
    tris = countTriangles(doc);
  }
  if (tris > TRIANGLE_LIMIT)
    throw new Rejected(`The model still has ${tris.toLocaleString('en-US')} triangles after simplifying; the limit is ${TRIANGLE_LIMIT.toLocaleString('en-US')}. Reduce detail in your modelling tool.`);

  const ktx2 = await compressTextures(doc, tools);
  const thumbnail = renderThumbnail(doc);
  const b = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
  const round = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000) as [number, number, number];

  doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER, encodeSpeed: 5, decodeSpeed: 5 });
  doc.getRoot().getAsset().generator = 'EcoManage modelconv (glTF-Transform)';
  const out = await io.writeBinary(doc);
  return { glb: out, thumbnail, stats: { trisIn, tris, bbox: { min: round(b.min), max: round(b.max) }, scale, textures: doc.getRoot().listTextures().length, ktx2 } };
};
