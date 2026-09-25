import mongoose, { Schema, Document } from 'mongoose';

export interface IDevice extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  type: 'solar' | 'wind' | 'battery' | 'grid';
  status: 'online' | 'offline' | 'charging' | 'maintenance';
  currentOutput: number;
  maxOutput: number;
  efficiency: number;
  lastMaintenance: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IDevice>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['solar', 'wind', 'battery', 'grid'],
      required: true,
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'charging', 'maintenance'],
      default: 'online',
    },
    currentOutput: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxOutput: {
      type: Number,
      required: true,
      min: 0,
    },
    efficiency: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
    },
    lastMaintenance: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const Device = mongoose.model<IDevice>('Device', schema);

export default Device;
