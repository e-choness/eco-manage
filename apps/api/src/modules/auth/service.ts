import jwt from 'jsonwebtoken';
import UserService, { CreateUserInput } from './userService';
import { IUser } from './model';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/auth';

export interface Session {
  user: IUser;
  accessToken: string;
  refreshToken: string;
}

export type RefreshResult = { ok: true; session: Session } | { ok: false; reason: 'invalid' | 'expired' };

// Issues a token pair and stores the refresh token so it can be rotated and revoked.
const startSession = async (user: IUser): Promise<Session> => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  user.refreshToken = refreshToken;
  await user.save();
  return { user, accessToken, refreshToken };
};

const subjectOf = (token: string): string | null => {
  try {
    return verifyRefreshToken(token).sub;
  } catch {
    return null;
  }
};

export const login = async (email: string, password: string): Promise<Session | null> => {
  const user = await UserService.authenticateWithPassword(email, password);
  return user ? startSession(user) : null;
};

export const register = (input: CreateUserInput): Promise<IUser> => UserService.create(input);

export const refresh = async (token: string): Promise<RefreshResult> => {
  let sub: string;
  try {
    sub = verifyRefreshToken(token).sub;
  } catch (err) {
    return { ok: false, reason: err instanceof jwt.TokenExpiredError ? 'expired' : 'invalid' };
  }
  const user = await UserService.get(sub);
  if (!user || user.refreshToken !== token) return { ok: false, reason: 'invalid' };
  return { ok: true, session: await startSession(user) };
};

// Revokes the session that owns this refresh token. Unknown or expired tokens are ignored.
export const logout = async (token: string | undefined): Promise<void> => {
  const sub = token ? subjectOf(token) : null;
  if (!sub) return;
  const user = await UserService.get(sub);
  if (user && user.refreshToken === token) {
    user.refreshToken = undefined;
    await user.save();
  }
};

export const changePassword = async (user: IUser, currentPassword: string, newPassword: string): Promise<boolean> => {
  const verified = await UserService.authenticateWithPassword(user.email, currentPassword);
  if (!verified) return false;
  await UserService.setPassword(verified, newPassword);
  return true;
};

export const updateProfile = (userId: string, name: string | undefined): Promise<IUser | null> =>
  UserService.update(userId, { name });
