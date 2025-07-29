import api from './api';

// Description: Get all alerts
// Endpoint: GET /api/alerts
// Request: {}
// Response: { alerts: Array<{ _id: string, title: string, message: string, type: string, timestamp: string, read: boolean, resolved: boolean }> }
export const getAlerts = () => {
  console.log('Fetching alerts');
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        alerts: [
          {
            _id: '1',
            title: 'Solar Panel Efficiency Drop',
            message: 'Solar Panel Array B showing 15% efficiency drop. Cleaning recommended.',
            type: 'warning',
            timestamp: '2024-01-25T10:30:00Z',
            read: false,
            resolved: false
          },
          {
            _id: '2',
            title: 'High Energy Consumption',
            message: 'Energy consumption 25% above average for this time of day.',
            type: 'info',
            timestamp: '2024-01-25T09:15:00Z',
            read: true,
            resolved: false
          },
          {
            _id: '3',
            title: 'Battery Storage Full',
            message: 'Battery storage at 100% capacity. Consider selling excess energy to grid.',
            type: 'info',
            timestamp: '2024-01-25T08:45:00Z',
            read: true,
            resolved: true
          },
          {
            _id: '4',
            title: 'Wind Turbine Offline',
            message: 'Wind Turbine 1 has gone offline. Maintenance required.',
            type: 'critical',
            timestamp: '2024-01-24T16:20:00Z',
            read: false,
            resolved: false
          }
        ]
      });
    }, 500);
  });
  // try {
  //   return await api.get('/api/alerts');
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};

// Description: Mark alert as read
// Endpoint: PUT /api/alerts/read
// Request: { alertId: string }
// Response: { success: boolean, message: string }
export const markAlertAsRead = (alertId: string) => {
  console.log('Marking alert as read:', alertId);
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        success: true,
        message: 'Alert marked as read'
      });
    }, 300);
  });
  // try {
  //   return await api.put('/api/alerts/read', { alertId });
  // } catch (error) {
  //   throw new Error(error?.response?.data?.message || error.message);
  // }
};