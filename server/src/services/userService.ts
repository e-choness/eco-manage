import User, { IUser } from '../models/User.js';
import { generatePasswordHash, validatePassword } from '../utils/password.js';

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
}

class UserService {
  static async list(): Promise<IUser[]> {
    try {
      return await User.find();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Database error while listing users: ${error.message}`);
    }
  }

  static async get(id: string): Promise<IUser | null> {
    try {
      return await User.findOne({ _id: id }).exec();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Database error while getting the user by their ID: ${error.message}`);
    }
  }

  static async getByEmail(email: string): Promise<IUser | null> {
    try {
      return await User.findOne({ email }).exec();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Database error while getting the user by their email: ${error.message}`);
    }
  }

  static async update(id: string, data: Partial<IUser>): Promise<IUser | null> {
    try {
      return await User.findOneAndUpdate({ _id: id }, data, { new: true, upsert: false });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Database error while updating user ${id}: ${error.message}`);
    }
  }

  static async delete(id: string): Promise<boolean> {
    try {
      const result = await User.deleteOne({ _id: id }).exec();
      return result.deletedCount === 1;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Database error while deleting user ${id}: ${error.message}`);
    }
  }

  static async authenticateWithPassword(email: string, password: string): Promise<IUser | null> {
    if (!email) throw new Error('Email is required');
    if (!password) throw new Error('Password is required');

    try {
      const user = await User.findOne({ email }).exec();
      if (!user) return null;

      const passwordValid = await validatePassword(password, user.password);
      if (!passwordValid) return null;

      user.lastLoginAt = new Date();
      const updatedUser = await user.save();
      return updatedUser;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Database error while authenticating user ${email} with password: ${error.message}`);
    }
  }

  static async create({ email, password, name = '' }: CreateUserInput): Promise<IUser> {
    if (!email) throw new Error('Email is required');
    if (!password) throw new Error('Password is required');

    const existingUser = await UserService.getByEmail(email);
    if (existingUser) throw new Error('User with this email already exists');

    const hash = await generatePasswordHash(password);

    try {
      const user = new User({
        email,
        password: hash,
        name,
      });

      await user.save();
      return user;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Database error while creating new user: ${error.message}`);
    }
  }

  static async setPassword(user: IUser, password: string): Promise<IUser> {
    if (!password) throw new Error('Password is required');
    user.password = await generatePasswordHash(password);

    try {
      if (!user.isNew) {
        await user.save();
      }

      return user;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Database error while setting user password: ${error.message}`);
    }
  }
}

export default UserService;
