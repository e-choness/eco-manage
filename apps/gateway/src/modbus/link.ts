import ModbusRTU from 'modbus-serial';
import type { Table } from './decode';

// Modbus TCP and RTU (P5-04). One connection per TCP endpoint or serial port: devices on the same
// RS-485 bus share it and take turns (one request at a time on the wire). A failed request drops
// the connection, and the next one reconnects.

export type ModbusTarget =
  | { kind: 'tcp'; host: string; port: number; unitId: number; timeoutMs: number }
  | { kind: 'rtu'; path: string; baudRate: number; parity: 'none' | 'even' | 'odd'; unitId: number; timeoutMs: number };

export interface ModbusIO {
  read(table: Table, start: number, count: number): Promise<number[]>;
  write(start: number, words: number[]): Promise<void>;
}

class Bus {
  private client: ModbusRTU | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly target: ModbusTarget) {}

  private async connect(): Promise<ModbusRTU> {
    if (this.client?.isOpen) return this.client;
    const c = new ModbusRTU();
    if (this.target.kind === 'tcp') await c.connectTCP(this.target.host, { port: this.target.port });
    else await c.connectRTUBuffered(this.target.path, { baudRate: this.target.baudRate, parity: this.target.parity, dataBits: 8, stopBits: 1 });
    c.setTimeout(this.target.timeoutMs);
    this.client = c;
    return c;
  }

  /** Runs one request after the ones before it. */
  run<T>(unitId: number, fn: (c: ModbusRTU) => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      try {
        const c = await this.connect();
        c.setID(unitId);
        return await fn(c);
      } catch (err) {
        this.drop();
        throw err;
      }
    });
    this.tail = next.catch(() => undefined);
    return next;
  }

  drop(): void {
    const c = this.client;
    this.client = null;
    if (c?.isOpen) c.close(() => undefined);
  }
}

const buses = new Map<string, Bus>();
const busKey = (t: ModbusTarget) => (t.kind === 'tcp' ? `tcp:${t.host}:${t.port}` : `rtu:${t.path}`);

export const modbusIO = (target: ModbusTarget): ModbusIO => {
  const key = busKey(target);
  const bus = buses.get(key) ?? new Bus(target);
  buses.set(key, bus);
  return {
    read: (table, start, count) =>
      bus.run(target.unitId, async (c) => (table === 'input' ? await c.readInputRegisters(start, count) : await c.readHoldingRegisters(start, count)).data),
    write: async (start, words) => {
      await bus.run(target.unitId, (c) => c.writeRegisters(start, words));
    },
  };
};

/** Closes every connection (shutdown, tests). */
export const closeModbus = (): void => {
  for (const b of buses.values()) b.drop();
  buses.clear();
};
