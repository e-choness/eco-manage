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
