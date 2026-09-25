import type { DeviceDetail, DeviceView, TelemetrySeries } from '@ecomanage/shared';
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
