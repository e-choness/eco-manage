import '@testing-library/jest-dom'
import { afterEach, beforeAll, afterAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { setupServer } from 'msw/node'
import { HttpResponse, http } from 'msw'

// Cleanup after each test case
afterEach(() => {
  cleanup()
  localStorage.clear()
})

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString()
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Setup MSW server for API mocking
export const server = setupServer(
  // The refresh token is an httpOnly cookie, so it never appears in a response body.
  http.post('http://localhost:3000/api/auth/login', () => {
    return HttpResponse.json({
      _id: 'user-1',
      email: 'test@example.com',
      accessToken: 'mock-access-token',
    })
  }),

  http.post('http://localhost:3000/api/auth/register', () => {
    return HttpResponse.json({
      email: 'test@example.com',
    })
  }),

  http.post('http://localhost:3000/api/auth/logout', () => {
    return HttpResponse.json({
      success: true,
    })
  }),

  // Default: no refresh cookie, so there is no session to restore.
  http.post('http://localhost:3000/api/auth/refresh', () => {
    return HttpResponse.json({ message: 'Refresh token is required' }, { status: 401 })
  }),

  http.get('http://localhost:3000/api/auth/me', () => {
    return HttpResponse.json({
      email: 'test@example.com',
      name: 'Test User',
    })
  }),
)

// Start server before all tests
beforeAll(() => server.listen())

// Reset handlers after each test
afterEach(() => server.resetHandlers())

// Clean up after all tests
afterAll(() => server.close())

// Mock window.matchMedia for responsive design tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// jsdom has no ResizeObserver; recharts' ResponsiveContainer needs one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
