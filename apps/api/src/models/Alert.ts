import mongoose, { Schema, Document } from 'mongoose';

export interface IAlert extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  message: string;
  type: 'critical' | 'warning' | 'info';
  timestamp: Date;
  read: boolean;
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IAlert>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['critical', 'warning', 'info'],
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    resolved: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Index for efficient querying by user and timestamp
schema.index({ userId: 1, timestamp: -1 });

const Alert = mongoose.model<IAlert>('Alert', schema);

export default Alert;
