/**
 * P5-02: Settings → Site model → Upload a 3D file. The API checks the file (with a reason for
 * anything it refuses), keeps the original in object storage and queues it; a processed upload
 * becomes the site model, anchors carrying over, until the site switches back to generated.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Membership, ModelUpload, Site, SiteModel, type ObjectStore } from '@ecomanage/db';
import { DEFAULT_SITE_MODEL, MODEL_MAX_BYTES } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import type { JobClient } from '../../lib/jobs';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
const stored = new Map<string, Buffer>();
const removedPrefixes: string[] = [];
const objects: ObjectStore = {
  put: async (key, body) => void stored.set(key, Buffer.from(body)),
  get: async (key) => stored.get(key)!,
  removePrefix: async (prefix) => (removedPrefixes.push(prefix), 0),
  remove: async (key) => void stored.delete(key),
  publicUrl: (key) => `/cdn/${key}`,
};
const queued: string[] = [];
const jobs = { processModelUpload: async (id: string) => void queued.push(id) } as unknown as JobClient;
let app: ReturnType<typeof createApp>;

const glb = () => {
  const b = Buffer.alloc(20);
  b.write('glTF', 0);
  b.writeUInt32LE(2, 4);
  return b;
};

beforeAll(async () => {
  await connectTestDb('models');
  process.env.JWT_SECRET = 'models-jwt';
  process.env.ASSET_PUBLIC_URL = 'https://cdn.example.com/assets/';
  app = createApp({ env, jobs, objects });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto' });
  const password = await generatePasswordHash('pw123456');
  for (const role of ['owner', 'manager', 'installer'] as const) {
    const u = await User.create({ email: `${role}@example.com`, name: role === 'installer' ? 'Northside Solar' : role, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'models-jwt');
  }
});

afterAll(async () => {
  delete process.env.ASSET_PUBLIC_URL;
  await disconnectTestDb();
});

beforeEach(async () => {
  await Promise.all([ModelUpload.deleteMany({}), SiteModel.deleteMany({}), AuditEvent.deleteMany({})]);
  stored.clear();
  queued.length = 0;
  removedPrefixes.length = 0;
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
const upload = (who: string, name: string, data: Buffer, to = app) => as(who, request(to).post('/api/site/model/uploads')).attach('file', data, name);

/** What the worker leaves behind for a converted file. */
const processed = (id: string) =>
  ModelUpload.updateOne(
    { _id: id },
    { $set: { status: 'ready', assetPrefix: 'models/abc123/', hasThumb: true, glbBytes: 812_000, tris: 180_000, trisIn: 420_000, bbox: { min: [-20, 0, -12], max: [20, 9, 12] }, scale: 0.01, originalKey: null, processedAt: new Date() } }
  );

describe('POST /api/site/model/uploads', () => {
  it('stores the original privately and queues it for the converter', async () => {
    const res = await upload('installer', 'School v3.glb', glb());
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ originalName: 'School v3.glb', format: 'glb', bytes: 20, status: 'queued', reason: null, glbUrl: null, inUse: false, createdBy: { name: 'Northside Solar' } });
    expect(queued).toEqual([res.body.id]);
    const [key] = [...stored.keys()];
    expect(key).toMatch(new RegExp(`^uploads/${siteId}/${res.body.id}-[0-9a-f]{12}/original\\.glb$`));
    expect(await AuditEvent.countDocuments({ action: 'siteModel.upload', target: `modelUpload:${res.body.id}` })).toBe(1);
  });

  it('refuses what it can’t use, saying why', async () => {
    const refuse = async (name: string, data: Buffer, status = 422) => {
      const res = await upload('owner', name, data);
      expect(res.status).toBe(status);
      return res.body.error.message as string;
    };
    expect(await refuse('site.skp', Buffer.from('SketchUp'))).toMatch(/^SketchUp files can’t be converted on this server\. In SketchUp, use File → Export/);
    expect(await refuse('plan.dwg', Buffer.from('AC1027'))).toBe('“plan.dwg” isn’t a 3D file we can use. Upload a .glb or .gltf, or an OBJ, FBX or IFC file to convert.');
    expect(await refuse('model.glb', Buffer.from('PK\x03\x04zip'))).toBe('This .glb isn’t a binary glTF file (its header is missing).');
    expect(await refuse('model.gltf', Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'model.bin' }] })))).toBe(
      'This .gltf needs separate files (model.bin). Export it as a single .glb instead.'
    );
    expect(await refuse('huge.glb', Buffer.concat([glb(), Buffer.alloc(MODEL_MAX_BYTES)]), 413)).toBe('The file is over 30 MB. Reduce textures or detail in your modelling tool, or export as .glb.');
    expect((await as('owner', request(app).post('/api/site/model/uploads'))).body.error.message).toBe('Choose a 3D file to upload (form field `file`).');
    expect(stored.size).toBe(0);
    expect(queued).toEqual([]);
  });

  it('is for owners and installers, and needs storage and the worker', async () => {
    expect((await upload('manager', 'a.glb', glb())).status).toBe(403);
    const offline = createApp({ env });
    const res = await upload('owner', 'a.glb', glb(), offline);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe('Model uploads are unavailable right now (no storage or worker queue)');
  });
});

describe('using an upload as the site model', () => {
  it('lists uploads with their CDN links, and uses a processed one with the anchors carried over', async () => {
    const { id } = (await upload('installer', 'School.fbx', Buffer.from('Kaydara FBX Binary  \0'))).body;
    const waiting = await as('owner', request(app).post(`/api/site/model/uploads/${id}/use`));
    expect(waiting.status).toBe(409);
    expect(waiting.body.error.message).toBe('This upload hasn’t finished processing');

    await processed(id);
    const [item] = (await as('manager', request(app).get('/api/site/model/uploads'))).body.items;
    expect(item).toMatchObject({
      status: 'ready',
      glbUrl: 'https://cdn.example.com/assets/models/abc123/model.glb',
      thumbUrl: 'https://cdn.example.com/assets/models/abc123/thumb.png',
      tris: 180_000,
      trisIn: 420_000,
      scale: 0.01,
      bbox: { min: [-20, 0, -12], max: [20, 9, 12] },
      inUse: false,
    });

    const used = await as('installer', request(app).post(`/api/site/model/uploads/${id}/use`));
    expect(used.status).toBe(200);
    expect(used.body).toMatchObject({
      version: 1,
      source: 'upload',
      upload: { uploadId: id, glbUrl: 'https://cdn.example.com/assets/models/abc123/model.glb', originalName: 'School.fbx', tris: 180_000, bytes: 812_000, scale: 0.01 },
      hub: DEFAULT_SITE_MODEL.hub,
      anchors: DEFAULT_SITE_MODEL.anchors,
    });
    expect((await as('owner', request(app).get(`/api/site/model/uploads/${id}`))).body.inUse).toBe(true);
    expect((await as('manager', request(app).post(`/api/site/model/uploads/${id}/use`))).status).toBe(403);

    // Moving anchors keeps the uploaded model; switching back uses the generated scene.
    const edit = { hub: [1, 1, 1], anchors: DEFAULT_SITE_MODEL.anchors, buildingLabel: DEFAULT_SITE_MODEL.buildingLabel, camera: { view: 'fit' } };
    expect((await as('owner', request(app).put('/api/site/model')).send(edit)).body).toMatchObject({ version: 2, source: 'upload', hub: [1, 1, 1], upload: { uploadId: id } });
    expect((await as('owner', request(app).put('/api/site/model')).send({ ...edit, source: 'generated' })).body).toMatchObject({ version: 3, source: 'generated', upload: null });
    expect(await AuditEvent.countDocuments({ action: 'siteModel.update' })).toBe(3);
  });

  it('removes an upload that isn’t in use, with its files', async () => {
    const { id } = (await upload('owner', 'a.glb', glb())).body;
    expect((await as('owner', request(app).delete(`/api/site/model/uploads/${id}`))).status).toBe(409); // still queued
    await processed(id);
    await as('owner', request(app).post(`/api/site/model/uploads/${id}/use`));
    const inUse = await as('owner', request(app).delete(`/api/site/model/uploads/${id}`));
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.message).toBe('This model is in use. Switch the site to another model first.');

    const edit = { hub: [0, 1, 0], anchors: [], buildingLabel: [0, 3, 0], camera: { view: 'fit' }, source: 'generated' };
    await as('owner', request(app).put('/api/site/model')).send(edit);
    expect((await as('installer', request(app).delete(`/api/site/model/uploads/${id}`))).status).toBe(204);
    expect(removedPrefixes).toEqual(['models/abc123/']);
    expect(await ModelUpload.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments({ action: 'siteModel.uploadDelete' })).toBe(1);
    expect((await as('owner', request(app).get(`/api/site/model/uploads/${id}`))).status).toBe(404);
  });

  it('says why a rejected file can’t be used', async () => {
    const { id } = (await upload('owner', 'a.glb', glb())).body;
    await ModelUpload.updateOne({ _id: id }, { $set: { status: 'rejected', reason: 'The model is only 1.0 cm across. Export it in metres.' } });
    const res = await as('owner', request(app).post(`/api/site/model/uploads/${id}/use`));
    expect(res.body.error.message).toBe('This file can’t be used: The model is only 1.0 cm across. Export it in metres.');
  });
});
