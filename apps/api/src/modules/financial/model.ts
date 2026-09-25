import mongoose, { Schema, Document } from 'mongoose';

export interface IFinancialRecord extends Document {
  userId: mongoose.Types.ObjectId;
  date: Date;
  savings: number;
  revenue: number;
  costs: number;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IFinancialRecord>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    savings: {
      type: Number,
      default: 0,
      min: 0,
    },
    revenue: {
      type: Number,
      default: 0,
      min: 0,
    },
    costs: {
      type: Number,
      default: 0,
      min: 0,
    },
    category: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

// Index for efficient querying by user and date
schema.index({ userId: 1, date: -1 });

const FinancialRecord = mongoose.model<IFinancialRecord>('FinancialRecord', schema);

export default FinancialRecord;
