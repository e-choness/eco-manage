import mongoose, { Schema, Document } from 'mongoose';
import { isPasswordHash } from '../../utils/password';
import { randomUUID } from 'crypto';

export interface IUser extends Document {
  email: string;
  password: string;
  name?: string;
  theme?: 'dark' | 'light' | null; // App v2 theme, saved per user (P4-01); null follows the system
  createdAt: Date;
  lastLoginAt: Date;
  isActive: boolean;
  refreshToken?: string;
}

const schema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      index: true,
      unique: true,
      lowercase: true,
    },
    name: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    theme: {
      type: String,
      enum: ['dark', 'light', null],
      default: null,
    },
    password: {
      type: String,
      required: true,
      validate: { validator: isPasswordHash, message: 'Invalid password hash' },
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    refreshToken: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: () => randomUUID(),
    },
  },
  {
    versionKey: false,
  }
);

schema.set('toJSON', {
  transform: (_doc, ret) => {
    const { password: _password, refreshToken: _refreshToken, ...rest } = ret;
    return rest;
  },
});

const User = mongoose.model<IUser>('User', schema);

export default User;
