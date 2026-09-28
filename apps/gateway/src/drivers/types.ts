import type { WriteAction } from '@ecomanage/profiles';

// A device as the gateway talks to it (P5-04): Modbus registers or an OCPP charger.
export interface Driver {
  /** The reading fields now; throws when the device doesn't answer. */
  read(): Promise<Record<string, unknown>>;
  /**
   * Carries out a write action (limits already checked). Returns what undo() needs to put the
   * device back as it was, or null when there is nothing to undo (a restart).
   */
  write(action: string, params: Record<string, unknown>, spec: WriteAction, endsAt: number | null): Promise<unknown>;
  undo(action: string, undo: unknown, spec: WriteAction | undefined): Promise<void>;
}

/** The parameter a single-value action writes (everything but its end time). */
export const valueParam = (spec: WriteAction, params: Record<string, unknown>): { name: string; value: number } | null => {
  for (const [name, p] of Object.entries(spec.params)) {
    if (p.type === 'time' || p.type === 'schedule') continue;
    const v = params[name];
    if (typeof v === 'boolean') return { name, value: v ? 1 : 0 };
    if (typeof v === 'number') return { name, value: v };
  }
  return null;
};
