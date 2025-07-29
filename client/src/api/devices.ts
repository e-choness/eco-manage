import api from './api';

// Description: Get all devices
// Endpoint: GET /api/devices
// Request: {}
// Response: { devices: Array<{ _id: string, name: string, type: string, status: string, currentOutput: number, maxOutput: number, efficiency: number, lastMaintenance: string }> }
export const getDevices = () => {
  console.log('Fetching devices data');
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        devices: [
          {
            _id: '1',
            name: 'Solar Panel Array A',
            type: 'solar',
            status: 'online',
            currentOutput: 4.2,
            maxOutput: 5.0,
            efficiency: 84,
            lastMaintenance: '2024-01-15'
          },
          {
            _id: '2',
            name: 'Solar Panel Array B',
            type: 'solar',
            status: 'online',
            currentOutput: 2.3,
            maxOutput: 3.0,
            efficiency: 77,
            lastMaintenance: '2024-01-10'
          },
          {
            _id: '3',
            name: 'Wind Turbine 1',
            type: 'wind',
            status: 'online',
            currentOutput: 1.7,
            maxOutput: 2.5,
            efficiency: 68,
            lastMaintenance: '2024-01-20'
          },
          {
            _id: '4',
            name: 'Battery Storage Unit',
            type: 'battery',
            status: 'charging',
            currentOutput: 2.1,
            maxOutput: 10.0,
            efficiency: 95,
            lastMaintenance: '2024-01-05'
          }
        ]
      });
    }, 500);
  });
  // try {
  //   return await api.get('/api/devices');
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};

// Description: Add a new device
// Endpoint: POST /api/devices
// Request: { name: string, type: string, maxOutput: number }
// Response: { success: boolean, message: string, device: object }
export const addDevice = (data: { name: string; type: string; maxOutput: number }) => {
  console.log('Adding new device:', data);
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        success: true,
        message: 'Device added successfully',
        device: {
          _id: Date.now().toString(),
          ...data,
          status: 'offline',
          currentOutput: 0,
          efficiency: 0,
          lastMaintenance: new Date().toISOString().split('T')[0]
        }
      });
    }, 500);
  });
  // try {
  //   return await api.post('/api/devices', data);
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};