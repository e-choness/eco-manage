import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

// The gateway as the chargers' local central system, OCPP 1.6J (P5-04, Data and Device Audit §4
// step 02): chargers are set up to connect to ws://<gateway>:<port>/ocpp/<charge point id>. It
// answers what chargers send (boot, heartbeat, status, meter values, transactions) and sends them
// the cloud's commands. Optional basic auth (OCPP security profile 1) with a shared password.

const CALL = 2;
const RESULT = 3;
const ERROR = 4;

export interface Charger {
  id: string;
  connected: boolean;
  vendor: string | null;
  model: string | null;
  status: string | null; // StatusNotification status (connector 1, or 0 when that's all it sends)
  errorCode: string | null;
  meter: Record<string, number>; // latest value per measurand, in the charger's units as W / Wh / %
  transaction: { id: number; idTag: string; meterStartWh: number; startedAt: string } | null;
  lastSeenAt: string | null;
}

export interface OcppOptions {
  port: number;
  host?: string;
  heartbeatS?: number;
  password?: string; // basic auth for every charger, when set
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

const DEFAULT_MEASURAND = 'Energy.Active.Import.Register';

/** A sampled value in the unit the profile expects (W, Wh, %). */
const toBase = (value: number, unit?: string) => (unit === 'kW' || unit === 'kWh' ? value * 1000 : value);

export class OcppServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private readonly sockets = new Map<string, WebSocket>();
  private readonly state = new Map<string, Charger>();
  private readonly pending = new Map<string, Pending>();
  private nextTx = 1;

  constructor(private readonly opts: OcppOptions) {
    super();
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        port: this.opts.port,
        host: this.opts.host,
        handleProtocols: (protocols) => (protocols.has('ocpp1.6') ? 'ocpp1.6' : false),
        verifyClient: ({ req }, done) => done(this.allowed(req), 401, 'Unauthorized'),
      });
      wss.once('listening', () => resolve());
      wss.once('error', reject);
      wss.on('connection', (ws, req) => this.attach(ws, req));
      this.wss = wss;
    });
  }

  get port(): number {
    const a = this.wss?.address();
    return typeof a === 'object' && a ? a.port : this.opts.port;
  }

  private idOf(req: IncomingMessage): string | null {
    const m = /^\/ocpp\/([A-Za-z0-9_.:-]{1,48})\/?$/.exec(req.url ?? '');
    return m ? m[1] : null;
  }

  private allowed(req: IncomingMessage): boolean {
    const id = this.idOf(req);
    if (!id) return false;
    if (!this.opts.password) return true;
    const header = req.headers.authorization ?? '';
    const expected = `Basic ${Buffer.from(`${id}:${this.opts.password}`).toString('base64')}`;
    return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  }

  private charger(id: string): Charger {
    let c = this.state.get(id);
    if (!c) {
      c = { id, connected: false, vendor: null, model: null, status: null, errorCode: null, meter: {}, transaction: null, lastSeenAt: null };
      this.state.set(id, c);
    }
    return c;
  }

  private attach(ws: WebSocket, req: IncomingMessage): void {
    const id = this.idOf(req)!;
    this.sockets.get(id)?.close(1000, 'replaced by a new connection');
    this.sockets.set(id, ws);
    const c = this.charger(id);
    c.connected = true;
    this.emit('connect', id);
    ws.on('message', (data) => this.receive(id, ws, data.toString()));
    ws.on('close', () => {
      if (this.sockets.get(id) !== ws) return;
      this.sockets.delete(id);
      c.connected = false;
      this.emit('disconnect', id);
    });
  }

  private receive(id: string, ws: WebSocket, text: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(msg)) return;
    const c = this.charger(id);
    c.lastSeenAt = new Date().toISOString();
    if (msg[0] === CALL) {
      const [, uid, action, payload] = msg as [number, string, string, Record<string, unknown>];
      const reply = this.handle(c, action, payload ?? {});
      ws.send(JSON.stringify(reply === null ? [ERROR, uid, 'NotImplemented', `${action} is not supported`, {}] : [RESULT, uid, reply]));
      this.emit('update', id);
      return;
    }
    const p = this.pending.get(String(msg[1]));
    if (!p) return;
    this.pending.delete(String(msg[1]));
    clearTimeout(p.timer);
    if (msg[0] === RESULT) p.resolve(msg[2]);
    else if (msg[0] === ERROR) p.reject(new Error(`Charger refused: ${String(msg[2])} ${String(msg[3] ?? '')}`.trim()));
  }

  /** The answer to a charger's request, or null when it isn't supported. */
  private handle(c: Charger, action: string, p: Record<string, unknown>): Record<string, unknown> | null {
    const now = new Date().toISOString();
    switch (action) {
      case 'BootNotification':
        c.vendor = String(p.chargePointVendor ?? '') || null;
        c.model = String(p.chargePointModel ?? '') || null;
        return { status: 'Accepted', currentTime: now, interval: this.opts.heartbeatS ?? 60 };
      case 'Heartbeat':
        return { currentTime: now };
      case 'StatusNotification':
        // Connector 0 is the charger as a whole; it counts until a connector reports.
        if (Number(p.connectorId) !== 0 || c.status === null) {
          c.status = String(p.status ?? '') || null;
          c.errorCode = String(p.errorCode ?? 'NoError');
        }
        return {};
      case 'MeterValues':
        for (const mv of (p.meterValue as { sampledValue?: { value: string; measurand?: string; unit?: string; phase?: string }[] }[] | undefined) ?? [])
          for (const s of mv.sampledValue ?? []) {
            if (s.phase) continue; // totals only
            const v = Number(s.value);
            if (Number.isFinite(v)) c.meter[s.measurand ?? DEFAULT_MEASURAND] = toBase(v, s.unit);
          }
        return {};
      case 'Authorize':
        return { idTagInfo: { status: 'Accepted' } };
      case 'StartTransaction': {
        const tx = { id: this.nextTx++, idTag: String(p.idTag ?? ''), meterStartWh: Number(p.meterStart ?? 0), startedAt: String(p.timestamp ?? now) };
        c.transaction = tx;
        c.meter[DEFAULT_MEASURAND] = tx.meterStartWh;
        return { transactionId: tx.id, idTagInfo: { status: 'Accepted' } };
      }
      case 'StopTransaction':
        if (Number.isFinite(Number(p.meterStop))) c.meter[DEFAULT_MEASURAND] = Number(p.meterStop);
        c.transaction = null;
        return { idTagInfo: { status: 'Accepted' } };
      case 'DataTransfer':
        return { status: 'UnknownVendorId' };
      default:
        return null;
    }
  }

  /** Sends a request to a charger and waits for its answer. */
  call(id: string, action: string, payload: Record<string, unknown>, timeoutMs = 15_000): Promise<Record<string, unknown>> {
    const ws = this.sockets.get(id);
    if (!ws) return Promise.reject(new Error(`Charger ${id} is not connected`));
    const uid = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(uid);
        reject(new Error(`Charger ${id} didn’t answer ${action}`));
      }, timeoutMs);
      this.pending.set(uid, { resolve: (v) => resolve((v ?? {}) as Record<string, unknown>), reject, timer });
      ws.send(JSON.stringify([CALL, uid, action, payload]));
    });
  }

  get(id: string): Charger | undefined {
    return this.state.get(id);
  }

  chargers(): Charger[] {
    return [...this.state.values()];
  }

  async close(): Promise<void> {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    for (const ws of this.sockets.values()) ws.terminate();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
  }
}
