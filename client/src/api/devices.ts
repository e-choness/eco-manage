import api from './api';

// Description: Get all devices
// Endpoint: GET /api/devices
// Request: {}
// Response: { devices: Array<{ _id: string, name: string, type: string, status: string, currentOutput: number, maxOutput: number, efficiency: number, lastMaintenance: string }> }
export const getDevices = async () => {
  try {
    const response = await api.get('/api/devices');
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
  }
};

// Description: Add a new device
// Endpoint: POST /api/devices
// Request: { name: string, type: string, maxOutput: number }
// Response: { _id: string, name: string, type: string, status: string, maxOutput: number, efficiency: number }
export const addDevice = async (data: { name: string; type: string; maxOutput: number }) => {
  try {
    const response = await api.post('/api/devices', data);
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
  }
};