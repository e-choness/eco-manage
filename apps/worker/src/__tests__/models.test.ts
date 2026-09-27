/**
 * P5-02: an uploaded model goes from object storage through the converter; the result is stored
 * under a new random public prefix, a rejection keeps the converter's reason, and the original
 * is removed once processed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { ModelUpload, initModels, type ObjectStore } from '@ecomanage/db'
import { processModelUpload, type Converter } from '../models'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_worker_models`
const siteId = new mongoose.Types.ObjectId()
const userId = new mongoose.Types.ObjectId()
const NOW = new Date('2026-09-27T20:00:00Z')

const stored = new Map<string, { body: Buffer; type: string; cache?: string }>()
const objects: ObjectStore = {
  put: async (key, body, type, cache) => void stored.set(key, { body: Buffer.from(body), type, cache }),
  get: async (key) => stored.get(key)!.body,
  removePrefix: async () => 0,
  remove: async (key) => void stored.delete(key),
  publicUrl: (key) => `/cdn/${key}`,
}
const seen: { format: string; bytes: number }[] = []
const converter =
  (answer: Awaited<ReturnType<Converter>> | Error): Converter =>
  async (file, format) => {
    seen.push({ format, bytes: file.length })
    if (answer instanceof Error) throw answer
    return answer
  }

beforeAll(async () => {
  await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 })
  await mongoose.connection.dropDatabase()
  await initModels()
})

afterAll(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  await ModelUpload.deleteMany({})
  stored.clear()
  seen.length = 0
})

const queued = async (format: 'ifc' | 'fbx' = 'ifc') => {
  const key = `uploads/${siteId}/x/original.${format}`
  stored.set(key, { body: Buffer.from('ISO-10303-21;'), type: 'application/octet-stream' })
  return ModelUpload.create({ siteId, userId, originalName: `school.${format}`, format, bytes: 13, originalKey: key })
}

describe('processModelUpload', () => {
  it('stores the GLB and thumbnail under a new public prefix, cached for good', async () => {
    const u = await queued()
    const ok = converter({ ok: true, glb: Buffer.from('glTF-out'), thumbnail: Buffer.from('png'), stats: { trisIn: 420_000, tris: 190_000, bbox: { min: [-5, 0, -2], max: [5, 3, 2] }, scale: 1 } })
    expect(await processModelUpload({ uploadId: String(u._id) }, { objects, convert: ok, now: () => NOW })).toEqual({ status: 'ready', tris: 190_000 })
    expect(seen).toEqual([{ format: 'ifc', bytes: 13 }])
    const done = (await ModelUpload.findById(u._id).lean())!
    expect(done).toMatchObject({ status: 'ready', hasThumb: true, glbBytes: 8, tris: 190_000, trisIn: 420_000, scale: 1, processedAt: NOW, originalKey: null, bbox: { min: [-5, 0, -2], max: [5, 3, 2] } })
    expect(done.assetPrefix).toMatch(/^models\/[0-9a-f]{32}\/$/)
    expect([...stored.keys()].sort()).toEqual([`${done.assetPrefix}model.glb`, `${done.assetPrefix}thumb.png`])
    expect(stored.get(`${done.assetPrefix}model.glb`)).toMatchObject({ type: 'model/gltf-binary', cache: 'public, max-age=31536000, immutable' })
    // Done already: a second run does nothing.
    expect(await processModelUpload({ uploadId: String(u._id) }, { objects, convert: ok })).toEqual({ status: 'skipped' })
  })

  it('keeps the converter’s reason for a file it can’t use', async () => {
    const u = await queued('fbx')
    await processModelUpload({ uploadId: String(u._id) }, { objects, convert: converter({ ok: false, reason: 'The model has no surfaces (no triangles).' }), now: () => NOW })
    expect(await ModelUpload.findById(u._id).lean()).toMatchObject({ status: 'rejected', reason: 'The model has no surfaces (no triangles).', originalKey: null, assetPrefix: null })
    expect(stored.size).toBe(0)
  })

  it('marks our own failures for a retry and keeps the original', async () => {
    const u = await queued()
    await expect(processModelUpload({ uploadId: String(u._id) }, { objects, convert: converter(new Error('converter answered 500')) })).rejects.toThrow('converter answered 500')
    expect(await ModelUpload.findById(u._id).lean()).toMatchObject({ status: 'failed', reason: 'Processing failed on our side. Try uploading the file again.' })
    expect(stored.size).toBe(1)
    // The retry picks it up again.
    const ok = converter({ ok: true, glb: Buffer.from('g'), thumbnail: Buffer.alloc(0), stats: { trisIn: 12, tris: 12, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, scale: 1 } })
    expect(await processModelUpload({ uploadId: String(u._id) }, { objects, convert: ok })).toEqual({ status: 'ready', tris: 12 })
    expect(await ModelUpload.findById(u._id).lean()).toMatchObject({ status: 'ready', hasThumb: false, reason: null })
  })
})
