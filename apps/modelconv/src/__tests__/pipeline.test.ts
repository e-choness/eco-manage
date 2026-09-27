/**
 * P5-02: the converter turns every accepted upload into one GLB (metres, Y-up, centred, under 200k
 * triangles, Draco + KTX2) with a thumbnail, and rejects what it can't use with a clear reason.
 * Tests that need assimp, toktx or IfcOpenShell run in the converter's own image
 * (`docker compose run --rm --no-deps modelconv node_modules/.bin/vitest run`).
 */
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { PNG } from 'pngjs'
import { convertModel, countTriangles, glbContainerProblem, ktx2Size, TRIANGLE_LIMIT } from '../pipeline'
import { convertIsolated } from '../isolate'
import { Rejected, systemTools, type Tools } from '../tools'

const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0
const ASSIMP = has('assimp', ['version'])
const TOKTX = has('toktx', ['--version'])
const IFC = has('python3', ['-c', 'import ifcopenshell'])
const noTools: Tools = { toGlb: () => Promise.reject(new Error('no assimp')), ifcToGlb: () => Promise.reject(new Error('no IfcOpenShell')), toKtx2: null }
const tools = ASSIMP ? systemTools({ toktx: TOKTX }) : noTools

const png = (w: number, h: number) => {
  const p = new PNG({ width: w, height: h })
  for (let i = 0; i < w * h; i++) p.data.set([200, (i * 7) % 255, 80, 255], i * 4)
  return new Uint8Array(PNG.sync.write(p))
}

/** A box w × h × d (in file units) with a red material, optionally textured. */
const box = async (size: [number, number, number], opts: { texture?: [number, number]; at?: [number, number, number] } = {}) => {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const [x, y, z] = size.map((s) => s / 2)
  // 8 corners, 12 triangles
  const p = [-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z]
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 6, 2, 3, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3]
  const material = doc.createMaterial('brick').setBaseColorFactor([0.8, 0.2, 0.1, 1])
  if (opts.texture) material.setBaseColorTexture(doc.createTexture('bricks').setImage(png(...opts.texture)).setMimeType('image/png'))
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer))
    .setMaterial(material)
  if (opts.texture) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(16)).setBuffer(buffer))
  const node = doc.createNode('building').setMesh(doc.createMesh('building').addPrimitive(prim)).setTranslation(opts.at ?? [0, 0, 0])
  doc.createScene('site').addChild(node)
  return new NodeIO().writeBinary(doc)
}

/** A bumpy ground of n × n quads (2n² triangles), 100 m across. */
const terrain = async (n: number) => {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const pos = new Float32Array((n + 1) * (n + 1) * 3)
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) pos.set([(i / n) * 100, Math.sin(i / 7) * Math.cos(j / 5) * 2, (j / n) * 100], (i * (n + 1) + j) * 3)
  const idx = new Uint32Array(n * n * 6)
  let k = 0
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j
      idx.set([a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1], k)
      k += 6
    }
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)))
  return new NodeIO().writeBinary(doc)
}

const readOut = async (glb: Uint8Array) =>
  new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() }).readBinary(glb)

const reason = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (err) {
    if (err instanceof Rejected) return err.message
    throw err
  }
  return null
}

const OBJ = ['o cube', 'v -1 0 -1', 'v 1 0 -1', 'v 1 2 -1', 'v -1 2 -1', 'v -1 0 1', 'v 1 0 1', 'v 1 2 1', 'v -1 2 1', 'f 1 3 2', 'f 1 4 3', 'f 5 6 7', 'f 5 7 8', 'f 1 2 6', 'f 1 6 5', 'f 4 7 3', 'f 4 8 7', 'f 2 3 7', 'f 2 7 6', 'f 1 5 8', 'f 1 8 4', ''].join('\n')

// A 10 m × 0.3 m wall, 3 m high, in IFC4 (Z-up, metres).
const IFC_WALL = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('wall.ifc','2026-09-27T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9L',$,'Test',$,$,$,$,(#11),#6);
#2=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#3=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#4=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#5=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);
#6=IFCUNITASSIGNMENT((#2,#3,#4,#5));
#7=IFCCARTESIANPOINT((0.,0.,0.));
#8=IFCDIRECTION((0.,0.,1.));
#9=IFCDIRECTION((1.,0.,0.));
#10=IFCAXIS2PLACEMENT3D(#7,#8,#9);
#11=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#10,$);
#12=IFCSITE('1YvctVUKr0kugbFTf53O9L',$,'Site',$,$,#20,$,$,.ELEMENT.,$,$,$,$,$);
#13=IFCRELAGGREGATES('2YvctVUKr0kugbFTf53O9L',$,$,$,#1,(#12));
#14=IFCBUILDING('3YvctVUKr0kugbFTf53O9L',$,'School',$,$,#21,$,$,.ELEMENT.,$,$,$);
#15=IFCRELAGGREGATES('4YvctVUKr0kugbFTf53O9L',$,$,$,#12,(#14));
#16=IFCBUILDINGSTOREY('5YvctVUKr0kugbFTf53O9L',$,'Ground',$,$,#22,$,$,.ELEMENT.,0.);
#17=IFCRELAGGREGATES('6YvctVUKr0kugbFTf53O9L',$,$,$,#14,(#16));
#20=IFCLOCALPLACEMENT($,#10);
#21=IFCLOCALPLACEMENT(#20,#10);
#22=IFCLOCALPLACEMENT(#21,#10);
#30=IFCWALL('7YvctVUKr0kugbFTf53O9L',$,'Wall',$,$,#31,#40,$,$);
#31=IFCLOCALPLACEMENT(#22,#10);
#32=IFCRECTANGLEPROFILEDEF(.AREA.,$,#33,10.,0.3);
#33=IFCAXIS2PLACEMENT2D(#34,$);
#34=IFCCARTESIANPOINT((5.,0.15));
#35=IFCEXTRUDEDAREASOLID(#32,#10,#8,3.);
#36=IFCSHAPEREPRESENTATION(#11,'Body','SweptSolid',(#35));
#40=IFCPRODUCTDEFINITIONSHAPE($,$,(#36));
#41=IFCRELCONTAINEDINSPATIALSTRUCTURE('8YvctVUKr0kugbFTf53O9L',$,$,$,(#30),#16);
ENDSEC;
END-ISO-10303-21;
`

describe('glTF uploads', () => {
  it('centre the model on the origin with its base on the ground, Draco-compressed, with a thumbnail', async () => {
    const out = await convertModel(await box([20, 8, 12], { at: [100, 50, -30] }), 'glb', noTools)
    expect(out.stats).toMatchObject({ trisIn: 12, tris: 12, scale: 1, textures: 0, ktx2: false, bbox: { min: [-10, 0, -6], max: [10, 8, 6] } })
    const doc = await readOut(out.glb)
    expect(doc.getRoot().listExtensionsUsed().map((e) => e.extensionName)).toContain('KHR_draco_mesh_compression')
    expect(countTriangles(doc)).toBe(12)
    const thumb = PNG.sync.read(out.thumbnail)
    expect([thumb.width, thumb.height]).toEqual([480, 320])
    // Something is drawn in the middle, and the corners stay transparent.
    expect(thumb.data[(160 * 480 + 240) * 4 + 3]).toBe(255)
    expect(thumb.data[3]).toBe(0)
  })

  it('treat centimetre and millimetre exports as such', async () => {
    expect((await convertModel(await box([2000, 800, 1200]), 'glb', noTools)).stats).toMatchObject({ scale: 1 })
    expect((await convertModel(await box([4000, 800, 1200]), 'glb', noTools)).stats).toMatchObject({ scale: 0.01, bbox: { max: [20, 8, 6] } })
    expect((await convertModel(await box([40_000, 8000, 12_000]), 'glb', noTools)).stats).toMatchObject({ scale: 0.001, bbox: { max: [20, 8, 6] } })
  })

  it('simplify to under 200,000 triangles', async () => {
    const out = await convertModel(await terrain(400), 'glb', noTools) // 320,000 triangles
    expect(out.stats.trisIn).toBe(320_000)
    expect(out.stats.tris).toBeLessThanOrEqual(TRIANGLE_LIMIT)
    expect(out.stats.tris).toBeGreaterThan(50_000)
    expect(countTriangles(await readOut(out.glb))).toBe(out.stats.tris)
  })

  it('reject files that are broken, empty, or in the wrong units', async () => {
    const broken = new Document()
    broken.createScene().addChild(broken.createNode())
    const json = JSON.stringify({ asset: { version: '2.0' }, accessors: [{ componentType: 5126, count: 3, type: 'VEC3', bufferView: 0 }], bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 4 }] })
    expect(await reason(convertModel(new TextEncoder().encode(json), 'gltf', noTools))).toMatch(/^The glTF file has errors: /)
    expect(await reason(convertModel(await new NodeIO().writeBinary(broken), 'glb', noTools))).toBe('The model has no surfaces (no triangles). Export the building’s geometry, not only lines or points.')
    expect(await reason(convertModel(await box([5_000_000, 10, 10]), 'glb', noTools))).toBe('The model is about 5.0 km across. Export it in metres with the site near the origin.')
    expect(await reason(convertModel(await box([0.01, 0.01, 0.01]), 'glb', noTools))).toBe('The model is only 1.0 cm across. Export it in metres.')
  })

  it.skipIf(TOKTX)('refuse textures over 2048 px when they can’t be compressed', async () => {
    expect(await reason(convertModel(await box([10, 5, 10], { texture: [4096, 16] }), 'glb', noTools))).toBe('A texture is 4096×16 px; the limit is 2048 px. Resize it in your modelling tool.')
  })

  it.runIf(TOKTX)('compress textures to KTX2, resizing big ones to 2048 px in multiples of 4', async () => {
    const out = await convertModel(await box([10, 5, 10], { texture: [3000, 1000] }), 'glb', tools)
    expect(out.stats).toMatchObject({ textures: 1, ktx2: true })
    const doc = await readOut(out.glb)
    const texture = doc.getRoot().listTextures()[0]
    expect(texture.getMimeType()).toBe('image/ktx2')
    expect(doc.getRoot().listExtensionsRequired().map((e) => e.extensionName).sort()).toEqual(['KHR_draco_mesh_compression', 'KHR_texture_basisu'])
    // KTX2 header: the width is at byte 20.
    const image = texture.getImage()!
    const header = new DataView(image.buffer, image.byteOffset)
    expect([header.getUint32(20, true), header.getUint32(24, true)]).toEqual([2048, 684]) // width, height
  })
})

describe.runIf(ASSIMP)('converted uploads (assimp)', () => {
  it('turn OBJ and FBX into the same GLB', async () => {
    // ASCII FBX: assimp 5.2 can’t read back its own binary FBX (real exports from modelling tools are fine).
    const obj = await convertModel(new TextEncoder().encode(OBJ), 'obj', tools)
    expect(obj.stats).toMatchObject({ trisIn: 12, tris: 12, bbox: { min: [-1, 0, -1], max: [1, 2, 1] } })
    const fbx = spawnSync('sh', ['-c', `cd /tmp && printf '%s' "$OBJ" > t.obj && assimp export t.obj t.fbx -ffbxa >/dev/null && base64 -w0 t.fbx && rm t.obj t.fbx`], { env: { ...process.env, OBJ }, encoding: 'utf8' })
    const out = await convertModel(Buffer.from(fbx.stdout, 'base64'), 'fbx', tools)
    expect(out.stats.tris).toBe(12)
    expect(out.stats.bbox.max[1]).toBeCloseTo(2, 1)
  })

  it('reject a file assimp can’t read, with its reason', async () => {
    const why = await reason(convertModel(new TextEncoder().encode('Kaydara FBX Binary  \0\x1a\0garbage'), 'fbx', tools))
    expect(why).toMatch(/^The file couldn’t be converted: \S/)
    expect(why).not.toMatch(/tmp|Command failed|assimp export/)
  })
})

describe.runIf(ASSIMP && IFC)('IFC uploads (IfcOpenShell)', () => {
  it('turn an IFC wall into metres with Y up', async () => {
    const out = await convertModel(new TextEncoder().encode(IFC_WALL), 'ifc', tools)
    expect(out.stats.tris).toBe(12)
    const { min, max } = out.stats.bbox
    expect(max[0] - min[0]).toBeCloseTo(10, 2) // length along x
    expect(max[1] - min[1]).toBeCloseTo(3, 2) // height, now y
    expect(max[2] - min[2]).toBeCloseTo(0.3, 2) // thickness
    expect(min[1]).toBeCloseTo(0, 3)
  })

  it('reject an IFC with nothing to draw', async () => {
    const empty = IFC_WALL.replace(/#30=IFCWALL[^\n]*\n/, '').replace('(#30)', '()')
    expect(await reason(convertModel(new TextEncoder().encode(empty), 'ifc', tools))).toMatch(/^The IFC file (has no building elements with geometry|couldn’t be read)/)
  })
})

describe('isolation and damaged files', () => {
  it('reject a damaged GLB container before any library reads it', () => {
    const head = (magic: number, version: number, length: number, jsonLen: number, jsonType = 0x4e4f534a, json = '{}') => {
      const b = new Uint8Array(20 + json.length)
      const v = new DataView(b.buffer)
      v.setUint32(0, magic, true)
      v.setUint32(4, version, true)
      v.setUint32(8, length, true)
      v.setUint32(12, jsonLen, true)
      v.setUint32(16, jsonType, true)
      b.set(new TextEncoder().encode(json), 20)
      return b
    }
    const ok = head(0x46546c67, 2, 22, 2)
    expect(glbContainerProblem(ok)).toBeNull()
    expect(glbContainerProblem(new Uint8Array(8))).toBe('This .glb is damaged (it is too short). Export it again from your modelling tool.')
    expect(glbContainerProblem(head(0x12345678, 2, 22, 2))).toMatch(/no glTF header/)
    expect(glbContainerProblem(head(0x46546c67, 1, 22, 2))).toBe('This .glb is glTF version 1; only glTF 2.0 is supported.')
    expect(glbContainerProblem(head(0x46546c67, 2, 9999, 2))).toMatch(/shorter than its header says/)
    expect(glbContainerProblem(head(0x46546c67, 2, 22, 0))).toMatch(/its JSON part is missing/)
    expect(glbContainerProblem(head(0x46546c67, 2, 22, 2, 0x004e4942))).toMatch(/its JSON part is missing/)
    expect(glbContainerProblem(head(0x46546c67, 2, 22, 2, 0x4e4f534a, '{x'))).toMatch(/its JSON part can’t be read/)
  })

  it('convert in a worker thread, and stop one that runs too long', async () => {
    const out = await convertIsolated(await box([20, 8, 12]), 'glb', { toktx: false, timeoutMs: 60_000 })
    expect(out.stats.tris).toBe(12)
    expect(out.glb).toBeInstanceOf(Uint8Array)
    expect(await reason(convertIsolated(await terrain(400), 'glb', { toktx: false, timeoutMs: 50 }))).toBe('Processing the model took too long. Simplify it or export it as .glb.')
    // The bytes that once crashed the whole service: now a reason.
    const crashed = new Uint8Array(48)
    crashed.set(new TextEncoder().encode('glTF'))
    crashed[4] = 2
    expect(await reason(convertIsolated(crashed, 'glb', { toktx: false, timeoutMs: 60_000 }))).toMatch(/^This \.glb is damaged/)
  })
})

describe('texture sizes for KTX2', () => {
  it('cap the longer side at 2048 px and keep both sides a multiple of 4', () => {
    expect(ktx2Size([1024, 512])).toBeNull()
    expect(ktx2Size([4096, 64])).toEqual([2048, 32])
    expect(ktx2Size([3000, 1000])).toEqual([2048, 684])
    expect(ktx2Size([30, 10])).toEqual([32, 12])
    expect(ktx2Size([2, 2])).toEqual([4, 4])
  })
})
