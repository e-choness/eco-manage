import type { DeviceProfile } from '@ecomanage/profiles';
import type { OcppServer } from '../ocpp/server';
import type { Driver } from './types';

// An EV charger on the gateway's OCPP server (P5-04). Readings are the latest meter values and
// status it sent, mapped by the profile; commands become OCPP requests. Charging limits are a
// charging profile the gateway owns (id 1), so undoing one clears only its own.

const PROFILE_ID = 1;
const round = (x: number) => Math.round(x * 1e6) / 1e6;

const accepted = (action: string, res: Record<string, unknown>) => {
  const status = String(res.status ?? '');
  if (status !== 'Accepted' && status !== 'Scheduled') throw new Error(`The charger answered ${action} with ${status || 'nothing'}`);
};

const limitProfile = (connectorId: number, periods: { startPeriod: number; limit: number }[], validTo: string | null, startSchedule?: string) => ({
  connectorId,
  csChargingProfiles: {
    chargingProfileId: PROFILE_ID,
    stackLevel: 1,
    // TxDefaultProfile: applies to the session now and to any that starts before it ends.
    chargingProfilePurpose: 'TxDefaultProfile',
    chargingProfileKind: startSchedule ? 'Absolute' : 'Relative',
    ...(validTo ? { validTo } : {}),
    chargingSchedule: { chargingRateUnit: 'A', ...(startSchedule ? { startSchedule } : {}), chargingSchedulePeriod: periods },
  },
});

export const ocppDriver = (profile: DeviceProfile, server: OcppServer, chargePointId: string, connectorId = 1): Driver => {
  let limitA: number | null = null;
  return {
    async read() {
      const c = server.get(chargePointId);
      if (!c?.connected) throw new Error(`Charger ${chargePointId} is not connected`);
      const out: Record<string, unknown> = {};
      for (const r of profile.read) {
        if (!('message' in r)) continue;
        if (r.message === 'MeterValues' && r.measurand && c.meter[r.measurand] !== undefined) out[r.field] = round(c.meter[r.measurand] * (r.mult ?? 1));
      }
      if (c.status) out.state = profile.states[c.status] ?? c.status.toLowerCase();
      if (c.errorCode) out.fault = c.errorCode === 'NoError' ? [] : [{ code: c.errorCode, text: profile.faults[c.errorCode] ?? c.errorCode }];
      if (c.transaction) {
        const nowWh = c.meter['Energy.Active.Import.Register'] ?? c.transaction.meterStartWh;
        out.session = { id: String(c.transaction.id), idTag: c.transaction.idTag || undefined, kwh: round(Math.max(0, nowWh - c.transaction.meterStartWh) / 1000), startedAt: new Date(c.transaction.startedAt).toISOString() };
      }
      if (limitA !== null) out.limit_a = limitA;
      return out;
    },

    async write(action, params) {
      const until = typeof params.until === 'string' ? params.until : typeof params.validTo === 'string' ? params.validTo : null;
      switch (action) {
        case 'limit_current': {
          const amps = Number(params.amps);
          accepted(action, await server.call(chargePointId, 'SetChargingProfile', limitProfile(connectorId, [{ startPeriod: 0, limit: amps }], until)));
          limitA = amps;
          return { clearProfile: true };
        }
        case 'set_charging_profile': {
          const steps = ((params.schedule as { start: string; limitA: number }[] | undefined) ?? []).map((s) => ({ at: Date.parse(s.start), limit: Number(s.limitA) })).sort((a, b) => a.at - b.at);
          if (!steps.length || steps.some((s) => !Number.isFinite(s.at) || !Number.isFinite(s.limit))) throw new Error('The schedule is empty or unreadable');
          const start = steps[0].at;
          const periods = steps.map((s) => ({ startPeriod: Math.round((s.at - start) / 1000), limit: s.limit }));
          accepted(action, await server.call(chargePointId, 'SetChargingProfile', limitProfile(connectorId, periods, until, new Date(start).toISOString())));
          return { clearProfile: true };
        }
        case 'remote_start':
          accepted(action, await server.call(chargePointId, 'RemoteStartTransaction', { connectorId, idTag: 'ecomanage' }));
          return null;
        case 'remote_stop': {
          const tx = server.get(chargePointId)?.transaction;
          if (!tx) throw new Error('No session is running');
          accepted(action, await server.call(chargePointId, 'RemoteStopTransaction', { transactionId: tx.id }));
          return null;
        }
        case 'change_availability':
          accepted(action, await server.call(chargePointId, 'ChangeAvailability', { connectorId, type: params.operative ? 'Operative' : 'Inoperative' }));
          return params.operative ? null : { operative: true };
        case 'reset':
          accepted(action, await server.call(chargePointId, 'Reset', { type: 'Soft' }));
          return null;
        default:
          throw new Error(`${action} is not something this charger can do`);
      }
    },

    async undo(_action, undo) {
      const u = undo as { clearProfile?: boolean; operative?: boolean } | null;
      if (u?.clearProfile) {
        const res = await server.call(chargePointId, 'ClearChargingProfile', { id: PROFILE_ID });
        // Unknown: it was already gone (the charger rebooted, or the profile expired).
        if (res.status !== 'Accepted' && res.status !== 'Unknown') throw new Error(`The charger answered ClearChargingProfile with ${String(res.status)}`);
        limitA = null;
      }
      if (u?.operative) accepted('ChangeAvailability', await server.call(chargePointId, 'ChangeAvailability', { connectorId, type: 'Operative' }));
    },
  };
};
