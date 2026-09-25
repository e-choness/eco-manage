import mongoose, { Schema, Document } from 'mongoose';

export interface IWeather extends Document {
  userId: mongoose.Types.ObjectId;
  condition: 'sunny' | 'cloudy' | 'rainy' | 'stormy' | 'snowy';
  temperature: number;
  humidity: number;
  windSpeed: number;
  uvIndex: number;
  updatedAt: Date;
}

const schema = new Schema<IWeather>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
      unique: true,
    },
    condition: {
      type: String,
      enum: ['sunny', 'cloudy', 'rainy', 'stormy', 'snowy'],
      default: 'sunny',
    },
    temperature: {
      type: Number,
      default: 22,
      min: -50,
      max: 50,
    },
    humidity: {
      type: Number,
      default: 60,
      min: 0,
      max: 100,
    },
    windSpeed: {
      type: Number,
      default: 5,
      min: 0,
      max: 100,
    },
    uvIndex: {
      type: Number,
      default: 5,
      min: 0,
      max: 11,
    },
  },
  { timestamps: true }
);

const Weather = mongoose.model<IWeather>('Weather', schema);

export default Weather;
