import type { DeviceProfile, WriteAction } from '@ecomanage/profiles';
import { decodeScale, emptyRegisters, fieldsFrom, readPlan, storeBlock, type Block } from '../modbus/decode';
import { encodeValue, toRaw, type WriteType } from '../modbus/encode';
import type { ModbusIO } from '../modbus/link';
import { valueParam, type Driver } from './types';

// A Modbus device read and written from its profile (P5-04). Profile registers are absolute; a
// device whose documentation counts from 1 (or whose SunSpec block starts elsewhere) sets an
// offset in the gateway config.

interface Undo {
  reg: number;
  words: number[];
}

export const modbusDriver = (profile: DeviceProfile, io: ModbusIO, offset = 0): Driver => {
  const plan: Block[] = readPlan(profile);

  const scaleOf = async (spec: WriteAction): Promise<number> => {
    if (spec.scaleReg === undefined) return 0;
    const [w] = await io.read('holding', spec.scaleReg + offset, 1);
    const sf = decodeScale(w);
    if (sf === null) throw new Error('The device doesn’t report the scale for this setting');
    return sf;
  };

  return {
    async read() {
      const regs = emptyRegisters();
      for (const b of plan) storeBlock(regs, b, await io.read(b.table, b.start + offset, b.count));
      return fieldsFrom(profile, regs);
    },

    async write(action, params, spec, endsAt) {
      if (spec.reg === undefined) throw new Error(`${action} has no register in ${profile.id}`);
      const reg = spec.reg + offset;
      const one = valueParam(spec, params);
      // An action without a value (restart) is a trigger: write 1, nothing to undo.
      if (!one) {
        await io.write(reg, [1]);
        return null;
      }
      const type: WriteType = spec.type ?? (one.value < 0 ? 'int16' : 'uint16');
      const words = encodeValue(type, toRaw(one.value, spec.mult, await scaleOf(spec)));
      const before = await io.read('holding', reg, words.length);
      await io.write(reg, words);
      // Tell the device when to return to normal by itself (SunSpec *_RvrtTms): it then reverts
      // even if the gateway can't.
      if (spec.revertReg !== undefined && endsAt !== null) {
        await io.write(spec.revertReg + offset, encodeValue('uint16', Math.min(0xffff, Math.max(1, Math.ceil((endsAt - Date.now()) / 1000)))));
      }
      const undo: Undo = { reg, words: before };
      return undo;
    },

    async undo(_action, undo) {
      if (!undo) return;
      const u = undo as Undo;
      await io.write(u.reg, u.words);
    },
  };
};
