import api, { errorMessage } from './api';
import type { SessionUser } from './types';

// Description: Login user functionality
// Endpoint: POST /api/auth/login
// Request: { email: string, password: string }
// Response: user fields plus { accessToken }; the refresh token is set as an httpOnly cookie
export const login = async (email: string, password: string): Promise<SessionUser & { accessToken: string }> => {
  try {
    const response = await api.post('/api/auth/login', { email, password });
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Update user profile
// Endpoint: PUT /api/auth/profile
// Request: { name?: string, theme?: "dark" | "light" | null }
// Response: updated user object
export const updateProfile = async (data: { name?: string; theme?: "dark" | "light" | null }) => {
  try {
    const response = await api.put('/api/auth/profile', data);
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Change password
// Endpoint: PUT /api/auth/password
// Request: { currentPassword: string, newPassword: string }
// Response: { message: string }
export const changePassword = async (currentPassword: string, newPassword: string) => {
  try {
    const response = await api.put('/api/auth/password', { currentPassword, newPassword });
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};

// Description: Logout
// Endpoint: POST /api/auth/logout
// Request: {}
// Response: { success: boolean, message: string }
export const logout = async () => {
  try {
    return await api.post('/api/auth/logout');
  } catch (error) {
    throw new Error(errorMessage(error));
  }
};
