/**
 * P5-05: a site's own language model for explanations — any OpenAI-compatible API or Anthropic,
 * with the owner's key sealed at rest and never sent back; the server's default otherwise.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Device, LlmUsage, Membership, Recommendation, Site } from '@ecomanage/db';
import { dedupeKeyOf } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import { createSecrets } from '../../lib/secrets';
import { loadEnv } from '../../config/env';
import User from '../../modules/auth/model';
import { baseUrlProblem, openAiCompatibleExplainer, SYSTEM_PROMPT, type LlmConfig } from '../../modules/recommendations/llm';
import { serverLlmConfig } from '../../modules/recommendations/serverLlm';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const bat = new mongoose.Types.ObjectId();
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
const tokens: Record<string, string> = {};
const KEY = 'sk-test-1234567890ABCDWXYZ';
const SERVER: LlmConfig = { provider: 'anthropic', baseUrl: null, model: 'claude-opus-5', apiKey: 'server-key' };

// Model calls: which config each was made with; `failing` makes the next one fail.
const made: LlmConfig[] = [];
let failing = false;
const explainerFor = (config: LlmConfig) => async () => {
  made.push(config);
  if (failing) throw new Error('boom');
  return { text: 'Plain words.', model: config.model, inputTokens: 100, outputTokens: 50 };
};
const secrets = createSecrets('a-long-random-test-secret');
const withKeys = () => createApp({ env, explain: { server: { config: SERVER, monthlyTokens: 5000 }, secrets, explainerFor } });
let app: ReturnType<typeof createApp>;

const body = { provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'some/model', apiKey: KEY, monthlyTokens: 20_000 };

beforeAll(async () => {
  await connectTestDb('explanation_settings');
  process.env.JWT_SECRET = 'llm-jwt';
  app = withKeys();
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto', currency: 'CAD' });
  await Device.create({ _id: bat, siteId, type: 'battery', name: 'Battery', profileId: 'sunspec-storage-802@2', status: 'live' });
  const password = await generatePasswordHash('pw123456');
  for (const role of ['owner', 'manager'] as const) {
    const u = await User.create({ email: `${role}@example.com`, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'llm-jwt');
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  made.length = 0;
  failing = false;
  await Promise.all([Site.updateOne({ _id: siteId }, { $set: { explanations: null } }), AuditEvent.deleteMany({}), LlmUsage.deleteMany({}), Recommendation.deleteMany({})]);
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
const proposal = async () =>
  String(
    (
      await Recommendation.create({
        siteId,
        ruleId: 'peak-shaving',
        dedupeKey: dedupeKeyOf('peak-shaving', String(bat), { start: new Date(), end: new Date(Date.now() + Math.random() * 1e6) }),
        deviceId: String(bat),
        action: 'force_discharge',
        params: { kw: 25 },
        title: 'Discharge',
        window: { start: new Date(Date.now() + 3_600_000), end: new Date(Date.now() + 7_200_000) },
        expectedSavingCents: 1000,
        status: 'proposed',
        proposedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_000_000),
      })
    )._id
  );

describe('the site’s own model', () => {
  it('keeps the key sealed, shows only its end, and uses it for the site’s explanations', async () => {
    expect((await as('owner', request(app).get('/api/site/explanations'))).body).toMatchObject({ source: 'server', provider: 'anthropic', model: 'claude-opus-5', keyHint: null, canStoreKeys: true, monthlyTokens: 5000 });

    const res = await as('owner', request(app).put('/api/site/explanations')).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'site', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'some/model', keyHint: '…WXYZ', monthlyTokens: 20_000 });
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    const stored = (await Site.findById(siteId).lean())!.explanations!;
    expect(stored.keyEnc).not.toContain(KEY);
    expect(secrets.open(stored.keyEnc!)).toBe(KEY);
    const audit = await AuditEvent.findOne({ action: 'site.explanations' }).lean();
    expect(audit).toMatchObject({ after: { provider: 'openai-compatible', model: 'some/model', keyHint: '…WXYZ' } });
    expect(JSON.stringify(audit)).not.toContain(KEY);

    // Explanations now go to the site's model, with its budget.
    const id = await proposal();
    const explained = await as('manager', request(app).post(`/api/recommendations/${id}/explain`));
    expect(explained.body).toMatchObject({ model: 'some/model', budget: { usedTokens: 150, monthlyTokens: 20_000 } });
    expect(made.at(-1)).toEqual({ provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'some/model', apiKey: KEY });
    expect(await AuditEvent.findOne({ action: 'recommendation.explain' }).lean()).toMatchObject({ after: { source: 'site' } });
  });

  it('keeps the saved key when the form leaves it out, and asks for one the first time', async () => {
    const { apiKey: _k, ...noKey } = body;
    void _k;
    expect((await as('owner', request(app).put('/api/site/explanations')).send(noKey)).body.error.message).toBe('Enter the API key.');
    await as('owner', request(app).put('/api/site/explanations')).send(body);
    const changed = await as('owner', request(app).put('/api/site/explanations')).send({ ...noKey, model: 'another/model' });
    expect(changed.body).toMatchObject({ model: 'another/model', keyHint: '…WXYZ' });
    expect(secrets.open((await Site.findById(siteId).lean())!.explanations!.keyEnc!)).toBe(KEY);
  });

  it('refuses addresses on the server’s own network, and plain http', async () => {
    for (const baseUrl of ['http://api.example.com/v1', 'https://localhost:11434/v1', 'https://10.0.0.5/v1', 'https://192.168.1.20/v1', 'https://mongodb:27017', 'https://[::1]/v1', 'https://user:pw@api.example.com/v1']) {
      const res = await as('owner', request(app).put('/api/site/explanations')).send({ ...body, baseUrl });
      expect(res.status, baseUrl).toBe(400);
    }
    expect(baseUrlProblem('http://192.168.1.20:11434/v1', true)).toBeNull();
    expect(baseUrlProblem('https://api.groq.com/openai/v1')).toBeNull();
    expect(baseUrlProblem('ftp://x', true)).toBe('Use an http(s) URL.');
  });

  it('goes back to the server’s default when removed', async () => {
    await as('owner', request(app).put('/api/site/explanations')).send(body);
    const res = await as('owner', request(app).delete('/api/site/explanations'));
    expect(res.body).toMatchObject({ source: 'server', keyHint: null });
    expect(await AuditEvent.countDocuments({ action: 'site.explanations' })).toBe(2);
    await as('owner', request(app).post(`/api/recommendations/${await proposal()}/explain`));
    expect(made.at(-1)).toEqual(SERVER);
  });

  it('tries settings before they are saved, or the saved ones', async () => {
    const res = await as('owner', request(app).post('/api/site/explanations/test')).send(body);
    expect(res.body).toMatchObject({ ok: true, model: 'some/model', error: null });
    expect(await LlmUsage.countDocuments()).toBe(0); // not counted against the budget
    await as('owner', request(app).put('/api/site/explanations')).send(body);
    failing = true;
    expect((await as('owner', request(app).post('/api/site/explanations/test')).send({})).body).toMatchObject({ ok: false, error: 'The language model couldn’t be reached.' });
  });

  it('is the owner’s alone, and needs SECRETS_KEY to keep keys', async () => {
    expect((await as('manager', request(app).put('/api/site/explanations')).send(body)).status).toBe(403);
    expect((await as('manager', request(app).get('/api/site/explanations'))).status).toBe(403);
    const noSecrets = createApp({ env, explain: { server: null, explainerFor } });
    const res = await as('owner', request(noSecrets).put('/api/site/explanations')).send(body);
    expect(res.status).toBe(503);
    expect((await as('owner', request(noSecrets).get('/api/site/explanations'))).body).toMatchObject({ source: 'none', canStoreKeys: false });
    // Nobody can explain there: off, with a pointer to the setting.
    const off = await as('owner', request(noSecrets).post(`/api/recommendations/${await proposal()}/explain`));
    expect(off.status).toBe(503);
    expect(off.body.error.message).toMatch(/Settings → Rules → Explanations/);
  });
});

describe('an OpenAI-compatible API', () => {
  const config: LlmConfig = { provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1/', model: 'some-model', apiKey: KEY };
  const reply = (status: number, json: object) => async () => ({ ok: status < 300, status, json: async () => json });

  it('posts a chat completion with the system prompt and counts its tokens', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const explain = openAiCompatibleExplainer(config, async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ model: 'some-model-2026', choices: [{ message: { content: ' Plain words. ' }, finish_reason: 'stop' }], usage: { prompt_tokens: 310, completion_tokens: 80 } }) };
    });
    expect(await explain({ a: 1 })).toEqual({ text: 'Plain words.', model: 'some-model-2026', inputTokens: 310, outputTokens: 80 });
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(calls[0].init.headers).toMatchObject({ authorization: `Bearer ${KEY}` });
    expect(calls[0].init.redirect).toBe('error');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: 'some-model',
      max_tokens: 1500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'Recommendation:\n{\n  "a": 1\n}' },
      ],
    });
  });

  it('says why it failed', async () => {
    const says = async (fetchFn: Parameters<typeof openAiCompatibleExplainer>[1]) => {
      try {
        await openAiCompatibleExplainer(config, fetchFn)({});
        return null;
      } catch (err) {
        return (err as { body: { error: { message: string } } }).body.error.message;
      }
    };
    expect(await says(reply(401, {}))).toMatch(/API key was refused/);
    expect(await says(reply(404, {}))).toMatch(/model or URL wasn’t found/);
    expect(await says(reply(429, {}))).toMatch(/rate-limited or out of credit/);
    expect(await says(reply(500, {}))).toMatch(/answered 500/);
    expect(await says(reply(200, { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }))).toMatch(/couldn’t be written/);
    expect(await says(reply(200, { choices: [] }))).toMatch(/came back empty/);
    expect(await says(async () => Promise.reject(new Error('ECONNREFUSED')))).toMatch(/couldn’t be reached/);
  });
});

describe('the server’s default', () => {
  it('comes from the environment, and says what is missing', () => {
    expect(serverLlmConfig({})).toBeNull();
    expect(serverLlmConfig({ ANTHROPIC_API_KEY: 'k' })).toEqual({ provider: 'anthropic', baseUrl: null, model: 'claude-opus-5', apiKey: 'k' });
    expect(serverLlmConfig({ LLM_API_KEY: 'k', LLM_BASE_URL: 'https://api.openai.com/v1', LLM_MODEL: 'm' })).toEqual({ provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKey: 'k' });
    expect(serverLlmConfig({ LLM_API_KEY: 'k' })).toBe('an OpenAI-compatible model needs LLM_BASE_URL and LLM_MODEL');
    expect(serverLlmConfig({ LLM_PROVIDER: 'anthropic' })).toBe('LLM_API_KEY is not set');
  });

  it('reads variables compose leaves empty as not set', () => {
    const e = loadEnv({ DATABASE_URL: 'mongodb://x/y', JWT_SECRET: 'a', REFRESH_TOKEN_SECRET: 'b', LLM_PROVIDER: '', LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '', ANTHROPIC_API_KEY: '', LLM_ALLOW_PRIVATE_URLS: 'false' });
    expect(serverLlmConfig(e)).toBeNull();
    expect(e.LLM_ALLOW_PRIVATE_URLS).toBe(false);
    expect(() => loadEnv({ DATABASE_URL: 'mongodb://x/y', JWT_SECRET: 'a', REFRESH_TOKEN_SECRET: 'b', LLM_PROVIDER: 'openai' })).toThrow('LLM_PROVIDER');
  });

  it('seals and opens secrets, and refuses a tampered one', () => {
    const sealed = secrets.seal(KEY);
    expect(sealed).toMatch(/^v1\./);
    expect(secrets.open(sealed)).toBe(KEY);
    expect(() => createSecrets('another-secret-entirely').open(sealed)).toThrow();
    expect(() => secrets.open('v2.x.y.z')).toThrow('Unreadable secret');
  });
});
