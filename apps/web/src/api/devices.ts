import type { CommissionResult, CreateDeviceBody, DeviceDetail, DeviceView, FoundDevice, TelemetrySeries } from '@ecomanage/shared';
import api, { errorMessage } from './api';

// Description: Devices on the current site
// Endpoint: GET /api/devices
// Response: { items: DeviceView[] }
export const getDevices = async (): Promise<{ items: DeviceView[] }> => {
  try {
    const response = await api.get('/api/devices');
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: One device with profile and commissioning details
// Endpoint: GET /api/devices/:id
export const getDevice = async (id: string): Promise<DeviceDetail> => {
  try {
    const response = await api.get(`/api/devices/${id}`);
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Power over time, averaged per bucket (default: last 24 h, hourly)
// Endpoint: GET /api/devices/:id/telemetry?from&to&res
export const getDeviceTelemetry = async (id: string, params: { from?: string; to?: string; res?: string } = {}): Promise<TelemetrySeries> => {
  try {
    const response = await api.get(`/api/devices/${id}/telemetry`, { params });
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Add a device a scan found; it starts as pending until commissioned (installer)
// Endpoint: POST /api/devices
export const createDevice = async (body: CreateDeviceBody): Promise<DeviceView> => {
  try {
    const response = await api.post('/api/devices', body);
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Ask the gateway what is connected that the site doesn't have yet (installer)
// Endpoint: POST /api/devices/scan
export const scanDevices = async (): Promise<{ found: FoundDevice[] }> => {
  try {
    const response = await api.post('/api/devices/scan', {});
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Commission a pending device: the gateway starts reading it and runs its checks
// Endpoint: POST /api/devices/:id/commission
export const commissionDevice = async (id: string): Promise<CommissionResult> => {
  try {
    const response = await api.post(`/api/devices/${id}/commission`, {});
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Installer's visit note on the maintenance log
// Endpoint: POST /api/devices/:id/maintenance
export const logVisit = async (id: string, text: string): Promise<DeviceDetail['maintenance'][number]> => {
  try {
    const response = await api.post(`/api/devices/${id}/maintenance`, { text });
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Propose a change to a device; it waits in the Inbox for approval (owner, manager)
// Endpoint: POST /api/recommendations
export interface ProposeBody {
  deviceId: string;
  action: string;
  params: Record<string, unknown>;
  window: { start: string; end: string };
}

export const proposeChange = async (body: ProposeBody): Promise<{ id: string }> => {
  try {
    const response = await api.post('/api/recommendations', body);
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};
