import mongoose, { Schema, Document } from 'mongoose';

export interface IEnergyReading extends Document {
  deviceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  timestamp: Date;
  value: number;
  type: 'production' | 'consumption';
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IEnergyReading>(
  {
    deviceId: {
      type: Schema.Types.ObjectId,
      ref: 'Device',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    type: {
      type: String,
      enum: ['production', 'consumption'],
      required: true,
    },
  },
  { timestamps: true }
);

// Create compound index for efficient querying by user and timestamp
schema.index({ userId: 1, timestamp: -1 });
schema.index({ deviceId: 1, timestamp: -1 });

const EnergyReading = mongoose.model<IEnergyReading>('EnergyReading', schema);

export default EnergyReading;
