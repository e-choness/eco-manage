/**
 * P5-02: first checks on an uploaded 3D file (size, extension, signature), each with a reason the
 * uploader can act on.
 */
import { describe, expect, it } from 'vitest'
import { MODEL_ACCEPT, MODEL_MAX_BYTES, modelFileProblem, modelFormatOf } from '../modelFiles'

const bytes = (s: string) => new TextEncoder().encode(s)
const glb = (version: number) => {
  const b = new Uint8Array(12)
  b.set(bytes('glTF'))
  new DataView(b.buffer).setUint32(4, version, true)
  return b
}

describe('model files', () => {
  it('know their format from the name', () => {
    expect(modelFormatOf('School.GLB')).toBe('glb')
    expect(modelFormatOf(' site.ifc ')).toBe('ifc')
    expect(modelFormatOf('plan.dwg')).toBeNull()
    expect(modelFormatOf('noextension')).toBeNull()
    expect(MODEL_ACCEPT).toBe('.glb,.gltf,.obj,.fbx,.ifc,.skp')
  })

  it('refuse other files, empty ones and ones over 30 MB', () => {
    expect(modelFileProblem('plan.dwg', bytes('x'))).toMatch(/isn’t a 3D file we can use/)
    expect(modelFileProblem('a.glb', new Uint8Array())).toBe('The file is empty.')
    expect(modelFileProblem('a.glb', new Uint8Array(MODEL_MAX_BYTES + 1))).toBe(
      'The file is 30.0 MB; the limit is 30 MB. Reduce textures or detail in your modelling tool, or export as .glb.'
    )
  })

  it('check GLB headers and version', () => {
    expect(modelFileProblem('a.glb', glb(2))).toBeNull()
    expect(modelFileProblem('a.glb', glb(1))).toBe('This .glb is glTF version 1; only glTF 2.0 is supported. Re-export it as glTF 2.0.')
    expect(modelFileProblem('a.glb', bytes('PK\x03\x04'))).toBe('This .glb isn’t a binary glTF file (its header is missing).')
    expect(modelFileProblem('a.glb', bytes('glTF'))).toMatch(/version 0/)
  })

  it('take a .gltf only when everything is inside it', () => {
    const inline = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }], images: [{ bufferView: 0 }] })
    expect(modelFileProblem('a.gltf', bytes(inline))).toBeNull()
    const external = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'a.bin' }], images: [{ uri: 'b.png' }, { uri: 'c.png' }, { uri: 'd.png' }] })
    expect(modelFileProblem('a.gltf', bytes(external))).toBe('This .gltf needs separate files (a.bin, b.png, c.png, …). Export it as a single .glb instead.')
    expect(modelFileProblem('a.gltf', bytes(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'a.bin' }] })))).toBe(
      'This .gltf needs separate files (a.bin). Export it as a single .glb instead.'
    )
    expect(modelFileProblem('a.gltf', bytes(JSON.stringify({ asset: { version: '1.0' } })))).toBe('Only glTF 2.0 is supported. Re-export the model as glTF 2.0.')
    expect(modelFileProblem('a.gltf', bytes(JSON.stringify({})))).toBe('Only glTF 2.0 is supported. Re-export the model as glTF 2.0.')
    expect(modelFileProblem('a.gltf', bytes(JSON.stringify({ asset: { version: '2.0' } })))).toBeNull()
    expect(modelFileProblem('a.gltf', bytes('{nope'))).toBe('This .gltf isn’t valid JSON.')
  })

  it('check FBX, IFC and OBJ signatures, and explain SketchUp', () => {
    expect(modelFileProblem('a.fbx', bytes('Kaydara FBX Binary  \0'))).toBeNull()
    expect(modelFileProblem('a.fbx', bytes('; FBX 7.4.0 project file'))).toBeNull()
    expect(modelFileProblem('a.fbx', bytes('hello'))).toBe('This .fbx isn’t an FBX file (its header is missing).')
    expect(modelFileProblem('a.ifc', bytes('ISO-10303-21;\nHEADER;'))).toBeNull()
    expect(modelFileProblem('a.ifc', bytes('<xml/>'))).toBe('This .ifc isn’t an IFC file (it should start with ISO-10303-21).')
    expect(modelFileProblem('a.obj', bytes('# cube\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'))).toBeNull()
    expect(modelFileProblem('a.obj', bytes('just text'))).toBe('This .obj has no OBJ geometry (no vertex or face lines).')
    expect(modelFileProblem('a.obj', new Uint8Array([118, 32, 48, 0, 1]))).toBe('This .obj has no OBJ geometry (no vertex or face lines).')
    expect(modelFileProblem('a.skp', bytes('x'))).toMatch(/^SketchUp files can’t be converted on this server/)
  })
})
