import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import JSONbig from 'json-bigint';
import type { SessionUser } from './types';

// The access token lives only in memory. The refresh token is an httpOnly cookie
// (path /api/auth) that JavaScript can't read; /api/auth/refresh exchanges it for a new
// access token, so a page reload restores the session without storing tokens anywhere.
let accessToken: string | null = null;
let onSessionExpired: () => void = () => {};

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

/** Authorization header for requests made outside axios (the SSE stream uses fetch). */
export const authHeader = (): Record<string, string> => (accessToken ? { Authorization: `Bearer ${accessToken}` } : {});

export const setSessionExpiredHandler =(handler: () => void): void => {
  onSessionExpired = handler;
};

const localApi = axios.create({
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
  transformResponse: [(data) => (data ? JSONbig.parse(data) : data)],
});

const NO_REFRESH_URLS = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'];

export interface Session {
  accessToken: string;
  user: SessionUser;
}

// Several requests can fail with 401 at once; they all wait on the same refresh call.
let refreshing: Promise<Session | null> | null = null;

export const refreshSession = (): Promise<Session | null> => {
  refreshing ??= localApi
    .post<Session>('/api/auth/refresh')
    .then((res) => {
      accessToken = res.data.accessToken;
      return res.data;
    })
    .catch(() => {
      accessToken = null;
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
};

localApi.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

localApi.interceptors.response.use(
  (response) => response,
  async (error: AxiosError): Promise<unknown> => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const url = original?.url ?? '';

    if (error.response?.status !== 401 || !original || original._retry || NO_REFRESH_URLS.some((u) => url.includes(u))) {
      return Promise.reject(error);
    }

    original._retry = true;
    const session = await refreshSession();
    if (!session) {
      onSessionExpired();
      return Promise.reject(error);
    }
    original.headers.Authorization = `Bearer ${session.accessToken}`;
    return localApi(original);
  }
);

const api = {
  request: (config: AxiosRequestConfig) => localApi(config),
  get: (url: string, config?: AxiosRequestConfig) => localApi.get(url, config),
  post: (url: string, data?: unknown, config?: AxiosRequestConfig) => localApi.post(url, data, config),
  put: (url: string, data?: unknown, config?: AxiosRequestConfig) => localApi.put(url, data, config),
  delete: (url: string, config?: AxiosRequestConfig) => localApi.delete(url, config),
};

export default api;

// Pulls the server's message out of an axios error, falling back to the error's own message.
export const errorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string | { message?: string } } | undefined;
    const nested = typeof data?.error === 'object' ? data.error.message : data?.error;
    return data?.message || nested || error.message;
  }
  return error instanceof Error ? error.message : String(error);
};
