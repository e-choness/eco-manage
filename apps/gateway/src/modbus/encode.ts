// The registers a written value takes (P5-04): the inverse of decodeValue for the write types.

export type WriteType = 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32';

export const encodeValue = (type: WriteType, value: number): number[] => {
  if (!Number.isFinite(value)) throw new Error('Not a number');
  if (type === 'float32') {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value);
    return [view.getUint16(0), view.getUint16(2)];
  }
  const n = Math.round(value);
  const range: Record<Exclude<WriteType, 'float32'>, [number, number]> = { int16: [-0x8000, 0x7fff], uint16: [0, 0xffff], int32: [-0x80000000, 0x7fffffff], uint32: [0, 0xffffffff] };
  const [lo, hi] = range[type];
  if (n < lo || n > hi) throw new Error(`${value} doesn’t fit in ${type}`);
  if (type === 'int16' || type === 'uint16') return [n & 0xffff];
  const u = n >>> 0;
  return [u >>> 16, u & 0xffff];
};

/** The register value for a setting: value ÷ mult ÷ 10^sf. */
export const toRaw = (value: number, mult = 1, sf = 0): number => value / mult / 10 ** sf;
