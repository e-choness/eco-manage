import mongoose, { Schema, Document } from 'mongoose';

export interface IRecommendation extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  estimatedSavings: number;
  difficulty: 'easy' | 'medium' | 'hard';
  category: string;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IRecommendation>(
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
    description: {
      type: String,
      required: true,
    },
    priority: {
      type: String,
      enum: ['high', 'medium', 'low'],
      required: true,
    },
    estimatedSavings: {
      type: Number,
      default: 0,
      min: 0,
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'dismissed'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

// Index for efficient querying by user and status
schema.index({ userId: 1, status: 1 });

const Recommendation = mongoose.model<IRecommendation>('Recommendation', schema);

export default Recommendation;
