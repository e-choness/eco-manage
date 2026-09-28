import { ServerTCP } from 'modbus-serial';
import { encodeValue } from '../modbus/encode';

// Stand-ins for the bench hardware (P5-04): a SunSpec inverter and a three-phase CT meter over
// Modbus TCP, laid out as the profiles read them. The tests use them, and so does the dev stack's
// `gateway` profile (fake-devices.ts), until a real inverter and meter are on the bench.

export class FakeModbus {
  readonly holding = new Map<number, number>();
  readonly input = new Map<number, number>();
  readonly writes: { addr: number; value: number }[] = [];
  private server: ServerTCP | null = null;

  constructor(
    readonly port: number,
    private readonly unitId = 1
  ) {}

  start(host = '127.0.0.1'): Promise<void> {
    const read = (map: Map<number, number>) => (addr: number, length: number) => Array.from({ length }, (_, i) => map.get(addr + i) ?? 0);
    return new Promise((resolve, reject) => {
      const s = new ServerTCP(
        {
          // modbus-serial asks one at a time for a single register, else for the block.
          getHoldingRegister: (addr: number) => this.holding.get(addr) ?? 0,
          getInputRegister: (addr: number) => this.input.get(addr) ?? 0,
          getMultipleHoldingRegisters: read(this.holding),
          getMultipleInputRegisters: read(this.input),
          setRegister: (addr: number, value: number) => {
            this.writes.push({ addr, value });
            this.holding.set(addr, value);
          },
        },
        { host, port: this.port, unitID: this.unitId }
      );
      s.on('initialized', () => resolve());
      s.on('serverError', reject);
      this.server = s;
    });
  }

  set(addr: number, words: number[], table: 'holding' | 'input' = 'holding'): void {
    words.forEach((w, i) => this[table].set(addr + i, w));
  }

  close(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

const str = (s: string, words: number) => {
  const b = Buffer.alloc(words * 2);
  b.write(s, 'latin1');
  return Array.from({ length: words }, (_, i) => b.readUInt16BE(i * 2));
};

/** A three-phase string inverter: SunSpec common model (65 registers) then model 103. */
export const fakeInverter = (dev: FakeModbus, opts: { maker?: string; model?: string } = {}) => {
  dev.set(40000, [0x5375, 0x6e53, 1, 65]); // "SunS", model 1, length 65
  dev.set(40004, str(opts.maker ?? 'Fronius', 16));
  dev.set(40020, str(opts.model ?? 'Symo 10.0-3-M', 16));
  dev.set(40069, [103, 50]); // model 103 from 40071
  dev.set(40121, [0xffff, 0]); // end of models
  dev.set(40075, [0xfffe]); // A_SF −2
  dev.set(40082, [0xffff]); // V_SF −1
  dev.set(40084, [0]); // W_SF
  dev.set(40086, [0xfffe]); // Hz_SF −2
  dev.set(40092, [0]); // PF_SF
  dev.set(40095, [0]); // WH_SF
  dev.set(40106, [0xffff]); // Tmp_SF −1
  dev.set(40232, [100]); // WMaxLimPct: no limit
  return {
    /** Output now, in watts, with the matching current, voltage and running state. */
    produce(watts: number, whTotal: number) {
      dev.set(40071, [Math.round((watts / 690) * 100)]);
      dev.set(40079, [2301]);
      dev.set(40083, encodeValue('int16', watts));
      dev.set(40085, [5000]);
      dev.set(40091, [100]);
      dev.set(40093, encodeValue('uint32', whTotal));
      dev.set(40102, [412]);
      dev.set(40107, [watts > 0 ? 4 : 2]);
      dev.set(40109, [0, 0]);
    },
  };
};

/** A CT meter in input registers (float32): power in W, import positive. */
export const fakeMeter = (dev: FakeModbus) => ({
  measure(watts: number, importKwh: number, exportKwh = 0) {
    const f = (x: number) => encodeValue('float32', x);
    dev.set(0, [...f(231.2), ...f(230.8), ...f(229.9)], 'input');
    dev.set(6, [...f(Math.abs(watts) / 690), ...f(0), ...f(0)], 'input');
    dev.set(52, f(watts), 'input');
    dev.set(62, f(0.97), 'input');
    dev.set(70, f(50), 'input');
    dev.set(72, [...f(importKwh), ...f(exportKwh)], 'input');
  },
});
