import api from './api';

// Description: Login user functionality
// Endpoint: POST /api/auth/login
// Request: { email: string, password: string }
// Response: { accessToken: string, refreshToken: string }
export const login = async (email: string, password: string) => {
  try {
    const response = await api.post('/api/auth/login', { email, password });
    return response.data;
  } catch (error) {
    console.error('Login error:', error);
    throw new Error(error?.response?.data?.message || error.message);
  }
};

// Description: Register user functionality
// Endpoint: POST /api/auth/register
// Request: { email: string, password: string, name: string }
// Response: { email: string }
export const register = async (email: string, password: string, name: string) => {
  try {
    const response = await api.post('/api/auth/register', { email, password, name });
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
  }
};

// Description: Update user profile
// Endpoint: PUT /api/auth/profile
// Request: { name?: string }
// Response: updated user object
export const updateProfile = async (data: { name?: string }) => {
  try {
    const response = await api.put('/api/auth/profile', data);
    return response.data;
  } catch (error) {
    throw new Error(error?.response?.data?.message || error.message);
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
    throw new Error(error?.response?.data?.message || error.message);
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
    throw new Error(error?.response?.data?.message || error.message);
  }
};
