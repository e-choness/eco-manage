import type {
  ApprovalPatch,
  BatteryPatch,
  CalendarInput,
  CalendarView,
  GatewayView,
  InviteView,
  MemberView,
  ModelUploadView,
  NotificationPrefs,
  NotificationPrefsPatch,
  PeopleResponse,
  PvArraysInput,
  RulePatch,
  RulesResponse,
  SiteModel,
  SiteModelInput,
  SitePatch,
  SiteSettings,
  Tariff,
  TariffInput,
  TariffIssue,
} from '@ecomanage/shared';
import axios from 'axios';
import api, { errorMessage } from './api';

const call = async <T>(p: Promise<{ data: T }>): Promise<T> => {
  try {
    return (await p).data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// ---- site ---------------------------------------------------------------------------------------

export const getSiteSettings = (): Promise<SiteSettings> => call(api.get('/api/site'));
export const patchSite = (patch: SitePatch): Promise<SiteSettings> => call(api.patch('/api/site', patch));
export const putPvArrays = (arrays: PvArraysInput): Promise<SiteSettings> => call(api.put('/api/site/pv-arrays', arrays));
export const patchBattery = (patch: BatteryPatch): Promise<SiteSettings> => call(api.patch('/api/site/battery', patch));
export const getGateway = (): Promise<GatewayView> => call(api.get('/api/site/gateway'));
export const putSiteModel = (model: SiteModelInput): Promise<SiteModel> => call(api.put('/api/site/model', model));

// ---- tariff -------------------------------------------------------------------------------------

export type TariffVersion = Tariff & { createdAt: string | null };
export const getTariffs = (): Promise<{ items: TariffVersion[]; current: number | null }> => call(api.get('/api/tariffs'));
export const getTariffTemplates = async (): Promise<{ id: string; name: string; tariff: Omit<TariffInput, 'validFrom'> }[]> =>
  (await call<{ items: { id: string; name: string; tariff: Omit<TariffInput, 'validFrom'> }[] }>(api.get('/api/tariffs/templates'))).items;

export class TariffRejected extends Error {
  constructor(public issues: TariffIssue[]) {
    super(issues.map((i) => i.message).join(' '));
  }
}

/** Saves a new tariff version; a 422 carries the gaps and overlaps to show next to the periods. */
export const createTariff = async (input: TariffInput): Promise<TariffVersion> => {
  try {
    return (await api.post('/api/tariffs', input)).data;
  } catch (error) {
    const issues = axios.isAxiosError(error) ? (error.response?.data as { error?: { details?: { issues?: TariffIssue[] } } })?.error?.details?.issues : undefined;
    if (issues?.length) throw new TariffRejected(issues);
    throw new Error(errorMessage(error));
  }
};

// ---- rules, calendar, notifications -------------------------------------------------------------

export const getRules = (): Promise<RulesResponse> => call(api.get('/api/rules'));
export const patchRule = (ruleId: string, patch: RulePatch): Promise<RulesResponse> => call(api.patch(`/api/rules/${ruleId}`, patch));
export const patchApproval = (patch: ApprovalPatch): Promise<RulesResponse> => call(api.patch('/api/rules/approval', patch));

export const getCalendar = (): Promise<CalendarView> => call(api.get('/api/calendar'));
export const putCalendar = (cal: CalendarInput): Promise<CalendarView> => call(api.put('/api/calendar', cal));

export const getNotifications = (): Promise<NotificationPrefs> => call(api.get('/api/me/notifications'));
export const patchNotifications = (patch: NotificationPrefsPatch): Promise<NotificationPrefs> => call(api.patch('/api/me/notifications', patch));

// ---- people -------------------------------------------------------------------------------------

export const getPeople = (): Promise<PeopleResponse> => call(api.get('/api/site/members'));
export const patchMember = (id: string, patch: { role?: string; until?: string | null }): Promise<MemberView> => call(api.patch(`/api/site/members/${id}`, patch));
export const removeMember = (id: string): Promise<unknown> => call(api.delete(`/api/site/members/${id}`));
export const inviteSomeone = (body: { email: string; role: string; until?: string | null }): Promise<InviteView> => call(api.post('/api/site/invites', body));
export const revokeInvite = (id: string): Promise<unknown> => call(api.delete(`/api/site/invites/${id}`));

// ---- 3D model uploads (P5-02) -------------------------------------------------------------------

export const getModelUploads = async (): Promise<ModelUploadView[]> => (await call<{ items: ModelUploadView[] }>(api.get('/api/site/model/uploads'))).items;
export const uploadModel = (file: File): Promise<ModelUploadView> => {
  const form = new FormData();
  form.append('file', file);
  return call(api.post('/api/site/model/uploads', form, { headers: { 'Content-Type': 'multipart/form-data' } }));
};
export const applyModelUpload = (id: string): Promise<SiteModel> => call(api.post(`/api/site/model/uploads/${id}/use`));
export const deleteModelUpload = (id: string): Promise<unknown> => call(api.delete(`/api/site/model/uploads/${id}`));
