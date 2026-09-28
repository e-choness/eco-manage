import type { DeviceProfile } from '@ecomanage/profiles';

// Turns Modbus registers into standard reading fields, as the device's profile says (P5-04). Pure:
// the poller reads the blocks readPlan() asks for and hands the words over.

type RegisterSource = Extract<DeviceProfile['read'][number], { reg: number }>;
export type RegType = RegisterSource['type'];
export type Table = 'holding' | 'input';

/** How many 16-bit registers a value of this type takes. */
export const WORDS: Record<RegType, number> = {
  int16: 1,
  uint16: 1,
  enum16: 1,
  bitfield16: 1,
  int32: 2,
  uint32: 2,
  acc32: 2,
  bitfield32: 2,
  float32: 2,
  acc64: 4,
};

// SunSpec marks a point it doesn't implement with these values.
const NOT_IMPLEMENTED: Partial<Record<RegType, number>> = { int16: 0x8000, uint16: 0xffff, enum16: 0xffff, bitfield16: 0xffff, int32: 0x80000000, uint32: 0xffffffff, bitfield32: 0xffffffff };

/** The value of `words` (big-endian, high word first), or null when the device doesn't implement it. */
export const decodeValue = (type: RegType, words: number[]): number | null => {
  if (words.length < WORDS[type]) return null;
  const u32 = () => ((words[0] << 16) | words[1]) >>> 0;
  const raw = WORDS[type] === 1 ? words[0] : WORDS[type] === 2 ? u32() : null;
  if (raw !== null && NOT_IMPLEMENTED[type] === raw) return null;
  switch (type) {
    case 'int16':
      return words[0] >= 0x8000 ? words[0] - 0x10000 : words[0];
    case 'int32':
      return u32() | 0;
    case 'float32': {
      const view = new DataView(new ArrayBuffer(4));
      view.setUint16(0, words[0]);
      view.setUint16(2, words[1]);
      const f = view.getFloat32(0);
      return Number.isFinite(f) ? f : null;
    }
    case 'acc64': {
      const big = (BigInt(words[0]) << 48n) | (BigInt(words[1]) << 32n) | (BigInt(words[2]) << 16n) | BigInt(words[3]);
      return Number(big);
    }
    default:
      return raw; // uint16, enum16, bitfield16, uint32, acc32, bitfield32
  }
};

/** A SunSpec scale factor (a signed power of ten), or null when not implemented. */
export const decodeScale = (word: number): number | null => (word === 0x8000 ? null : word >= 0x8000 ? word - 0x10000 : word);

export interface Block {
  table: Table;
  start: number; // absolute register, before the device's offset
  count: number;
}

const MAX_BLOCK = 120; // Modbus allows 125 registers per read

/**
 * The reads a poll needs: every register a field or its scale factor uses, merged into blocks
 * where the gap is small (a few spare registers cost less than another round trip).
 */
export const readPlan = (profile: DeviceProfile, maxGap = 8): Block[] => {
  const spans: { table: Table; start: number; end: number }[] = [];
  for (const r of profile.read) {
    if (!('reg' in r)) continue;
    const table = r.table ?? 'holding';
    spans.push({ table, start: r.reg, end: r.reg + WORDS[r.type] - 1 });
    if (r.scaleReg !== undefined) spans.push({ table, start: r.scaleReg, end: r.scaleReg });
  }
  const blocks: Block[] = [];
  for (const table of ['holding', 'input'] as const) {
    const mine = spans.filter((s) => s.table === table).sort((a, b) => a.start - b.start);
    let cur: { start: number; end: number } | null = null;
    for (const s of mine) {
      if (cur && s.start <= cur.end + maxGap + 1 && Math.max(cur.end, s.end) - cur.start + 1 <= MAX_BLOCK) cur.end = Math.max(cur.end, s.end);
      else {
        if (cur) blocks.push({ table, start: cur.start, count: cur.end - cur.start + 1 });
        cur = { start: s.start, end: s.end };
      }
    }
    if (cur) blocks.push({ table, start: cur.start, count: cur.end - cur.start + 1 });
  }
  return blocks;
};

/** Registers read so far, by table and absolute address. */
export type Registers = Record<Table, Map<number, number>>;

export const emptyRegisters = (): Registers => ({ holding: new Map(), input: new Map() });

export const storeBlock = (regs: Registers, block: Block, words: number[]): void => {
  words.forEach((w, i) => regs[block.table].set(block.start + i, w));
};

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * The reading fields the registers give. Numbers get their scale factor and multiplier; `v` and `a`
 * are per-phase lists; `state` is the profile's name for the value; `fault` lists the set bits.
 */
export const fieldsFrom = (profile: DeviceProfile, regs: Registers): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const r of profile.read) {
    if (!('reg' in r)) continue;
    const table = regs[r.table ?? 'holding'];
    const words = Array.from({ length: WORDS[r.type] }, (_, i) => table.get(r.reg + i));
    if (words.some((w) => w === undefined)) continue;
    const raw = decodeValue(r.type, words as number[]);
    if (raw === null) continue;
    if (r.field === 'state') {
      out.state = profile.states[String(raw)] ?? String(raw);
      continue;
    }
    if (r.field === 'fault') {
      const bits = WORDS[r.type] * 16;
      const set: { code: string; text: string }[] = [];
      for (let b = 0; b < bits; b++) if (Math.floor(raw / 2 ** b) % 2 === 1) set.push({ code: `bit${b}`, text: profile.faults[`bit${b}`] ?? `Fault bit ${b}` });
      out.fault = set;
      continue;
    }
    let value = raw;
    if (r.scaleReg !== undefined) {
      const sfWord = table.get(r.scaleReg);
      const sf = sfWord === undefined ? null : decodeScale(sfWord);
      if (sf === null) continue;
      value *= 10 ** sf;
    }
    value = round(value * (r.mult ?? 1));
    out[r.field] = r.field === 'v' || r.field === 'a' ? [value] : value;
  }
  return out;
};
