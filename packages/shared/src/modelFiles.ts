// 3D model uploads (P5-02, Data and Device Audit §6): what the site model editor accepts, and the
// first checks on a file before it is queued. glTF/GLB is used as it is; OBJ, FBX and IFC are
// converted to GLB in the sandboxed converter. Everything ends as one GLB: metres, Y-up, centred
// on the origin, under 200k triangles, textures 2048 px or smaller, Draco and KTX2 compressed.

export const MODEL_MAX_BYTES = 30 * 1024 * 1024;
export const MODEL_TRIANGLE_LIMIT = 200_000;
export const MODEL_TEXTURE_MAX_PX = 2048;

export const MODEL_FORMATS = ['glb', 'gltf', 'obj', 'fbx', 'ifc', 'skp'] as const;
export type ModelFormat = (typeof MODEL_FORMATS)[number];

/** What the file picker offers. */
export const MODEL_ACCEPT = MODEL_FORMATS.map((f) => `.${f}`).join(',');

export const MODEL_FORMAT_LABEL: Record<ModelFormat, string> = {
  glb: 'glTF binary (.glb)',
  gltf: 'glTF (.gltf)',
  obj: 'OBJ',
  fbx: 'FBX',
  ifc: 'IFC (BIM)',
  skp: 'SketchUp',
};

/** The format from a file name, or null when the extension isn't one we take. */
export const modelFormatOf = (filename: string): ModelFormat | null => {
  const ext = /\.([a-z0-9]+)$/i.exec(filename.trim())?.[1]?.toLowerCase();
  return (MODEL_FORMATS as readonly string[]).includes(ext ?? '') ? (ext as ModelFormat) : null;
};

const MB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Why a file of this size is refused, or null. */
export const modelSizeProblem = (bytes: number): string | null =>
  bytes > MODEL_MAX_BYTES ? `The file is ${MB(bytes)}; the limit is 30 MB. Reduce textures or detail in your modelling tool, or export as .glb.` : null;

const startsWith = (buf: Uint8Array, text: string) => buf.length >= text.length && text.split('').every((c, i) => buf[i] === c.charCodeAt(0));
const head = (buf: Uint8Array, n = 4096) => new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, n));

/**
 * Why a file can't be used, or null when it can go to the converter. These are the checks that
 * need no 3D tools: size, extension and the file's own signature. The converter checks the rest
 * (valid glTF, geometry, triangle count).
 */
export const modelFileProblem = (filename: string, buf: Uint8Array): string | null => {
  const format = modelFormatOf(filename);
  if (!format) return `“${filename}” isn’t a 3D file we can use. Upload a .glb or .gltf, or an OBJ, FBX or IFC file to convert.`;
  if (buf.length === 0) return 'The file is empty.';
  const tooBig = modelSizeProblem(buf.length);
  if (tooBig) return tooBig;
  switch (format) {
    case 'skp':
      return 'SketchUp files can’t be converted on this server. In SketchUp, use File → Export → 3D Model and choose glTF (.glb), OBJ or FBX, then upload that file.';
    case 'glb': {
      if (!startsWith(buf, 'glTF')) return 'This .glb isn’t a binary glTF file (its header is missing).';
      const version = buf.length >= 8 ? buf[4] | (buf[5] << 8) | (buf[6] << 16) | (buf[7] << 24) : 0;
      return version === 2 ? null : `This .glb is glTF version ${version}; only glTF 2.0 is supported. Re-export it as glTF 2.0.`;
    }
    case 'gltf': {
      let json: { asset?: { version?: string }; buffers?: { uri?: string }[]; images?: { uri?: string }[] };
      try {
        json = JSON.parse(new TextDecoder().decode(buf));
      } catch {
        return 'This .gltf isn’t valid JSON.';
      }
      if (json.asset?.version !== '2.0') return 'Only glTF 2.0 is supported. Re-export the model as glTF 2.0.';
      const external = [...(json.buffers ?? []), ...(json.images ?? [])].map((x) => x.uri).filter((u): u is string => !!u && !u.startsWith('data:'));
      return external.length
        ? `This .gltf needs separate files (${external.slice(0, 3).join(', ')}${external.length > 3 ? ', …' : ''}). Export it as a single .glb instead.`
        : null;
    }
    case 'fbx':
      return startsWith(buf, 'Kaydara FBX Binary') || /^\s*;\s*FBX/.test(head(buf, 64)) ? null : 'This .fbx isn’t an FBX file (its header is missing).';
    case 'ifc':
      return startsWith(buf, 'ISO-10303-21') ? null : 'This .ifc isn’t an IFC file (it should start with ISO-10303-21).';
    case 'obj':
      return /^\s*(v|vn|vt|f|o|g|mtllib|usemtl|s)\s/m.test(head(buf)) && !buf.subarray(0, 4096).includes(0) ? null : 'This .obj has no OBJ geometry (no vertex or face lines).';
  }
};
