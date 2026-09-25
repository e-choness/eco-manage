import { z } from 'zod';
import * as authService from './service';
import { currentUser, handle, HttpError, parse, userIdOf } from '../../lib/http';
import { clearRefreshCookie, readCookie, REFRESH_COOKIE, setRefreshCookie } from '../../utils/cookies';

const credentials = z.object({ email: z.string().min(1), password: z.string().min(1) });
const registration = credentials.extend({ name: z.string().optional() });
const passwordChange = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) });
const profile = z.object({ name: z.string().trim().min(1).optional() });

const REQUIRED = { message: 'Email and password are required' };

// The refresh token travels only in an httpOnly cookie; the access token is returned in the
// body and kept in memory by the client.
export const login = handle({ status: 400, body: { message: 'Login failed' } }, async (req, res) => {
  const { email, password } = parse(credentials, req.body, 400, REQUIRED);
  const session = await authService.login(email, password);
  if (!session) throw new HttpError(400, { message: 'Email or password is incorrect' });
  setRefreshCookie(res, session.refreshToken);
  res.json({ ...session.user.toJSON(), accessToken: session.accessToken });
});

export const register = handle(
  (err) => ({ status: 400, body: { message: err.message } }),
  async (req, res) => {
    const input = parse(registration, req.body, 400, REQUIRED);
    const user = await authService.register(input);
    res.status(201).json(user.toJSON());
  }
);

export const logout = handle({ status: 500, body: { message: 'Logout failed' } }, async (req, res) => {
  try {
    await authService.logout(readCookie(req, REFRESH_COOKIE));
  } finally {
    clearRefreshCookie(res);
  }
  res.status(200).json({ message: 'User logged out successfully.' });
});

export const refresh = handle({ status: 500, body: { message: 'Refresh failed' } }, async (req, res) => {
  const token = readCookie(req, REFRESH_COOKIE);
  if (!token) throw new HttpError(401, { message: 'Refresh token is required' });
  const result = await authService.refresh(token);
  if (!result.ok) {
    clearRefreshCookie(res);
    const message = result.reason === 'expired' ? 'Refresh token has expired' : 'Invalid refresh token';
    throw new HttpError(401, { message });
  }
  setRefreshCookie(res, result.session.refreshToken);
  res.json({ accessToken: result.session.accessToken, user: result.session.user.toJSON() });
});

export const me = handle({ status: 500, body: { message: 'Failed to get user' } }, async (req, res) => {
  res.status(200).json(currentUser(req).toJSON());
});

export const changePassword = handle({ status: 500, body: { message: 'Failed to change password' } }, async (req, res) => {
  const body = parse(passwordChange, req.body, 400, { message: 'Current password and new password are required' });
  if (body.newPassword.length < 6) throw new HttpError(400, { message: 'New password must be at least 6 characters' });
  const changed = await authService.changePassword(currentUser(req), body.currentPassword, body.newPassword);
  if (!changed) throw new HttpError(400, { message: 'Current password is incorrect' });
  res.status(200).json({ message: 'Password updated successfully' });
});

export const updateProfile = handle({ status: 500, body: { message: 'Failed to update profile' } }, async (req, res) => {
  const { name } = parse(profile, req.body, 400, { message: 'Name must be a non-empty string' });
  const updated = await authService.updateProfile(userIdOf(req), name);
  if (!updated) throw new HttpError(404, { message: 'User not found' });
  res.status(200).json(updated.toJSON());
});
