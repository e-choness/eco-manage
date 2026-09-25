import Device, { IDevice } from './model';

export const DEVICE_TYPES = ['solar', 'wind', 'battery', 'grid'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export interface NewDevice {
  name: string;
  type: DeviceType;
  maxOutput?: number;
}

export const listDevices = (userId: string): Promise<IDevice[]> => Device.find({ userId }).sort({ createdAt: -1 });

export const createDevice = (userId: string, input: NewDevice): Promise<IDevice> =>
  Device.create({
    userId,
    name: input.name,
    type: input.type,
    maxOutput: input.maxOutput || 5.0,
    status: 'online',
    efficiency: 90,
    lastMaintenance: new Date(),
  });

export const DEVICE_STATUSES = ['online', 'offline', 'charging', 'maintenance'] as const;

export interface DeviceUpdate {
  name?: string;
  maxOutput?: number;
  status?: (typeof DEVICE_STATUSES)[number];
}

// Both return null when the device doesn't exist or belongs to someone else.
export const updateDevice = (userId: string, deviceId: string, update: DeviceUpdate): Promise<IDevice | null> =>
  Device.findOneAndUpdate({ _id: deviceId, userId }, update, { new: true, runValidators: true });

export const deleteDevice = async (userId: string, deviceId: string): Promise<boolean> => {
  const result = await Device.deleteOne({ _id: deviceId, userId });
  return result.deletedCount === 1;
};
