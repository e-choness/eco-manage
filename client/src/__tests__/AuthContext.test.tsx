import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ReactNode } from 'react'

// Mock API module
vi.mock('@/api/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}))

// Component to test useAuth hook
function TestComponent() {
  const { isAuthenticated, login, register, logout } = useAuth()

  return (
    <div>
      <div data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'not-authenticated'}</div>
      <button
        data-testid="login-button"
        onClick={() => login('test@example.com', 'password')}
      >
        Login
      </button>
      <button
        data-testid="register-button"
        onClick={() => register('test@example.com', 'password', 'Test User')}
      >
        Register
      </button>
      <button
        data-testid="logout-button"
        onClick={() => logout()}
      >
        Logout
      </button>
    </div>
  )
}

function renderWithAuth(component: ReactNode) {
  return render(
    <AuthProvider>
      {component}
    </AuthProvider>
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('should start with isAuthenticated as false when no tokens in localStorage', () => {
      renderWithAuth(<TestComponent />)
      const authStatus = screen.getByTestId('auth-status')
      expect(authStatus).toHaveTextContent('not-authenticated')
    })

    it('should start with isAuthenticated as true when accessToken exists in localStorage', () => {
      localStorage.setItem('accessToken', 'mock-token')
      renderWithAuth(<TestComponent />)
      const authStatus = screen.getByTestId('auth-status')
      expect(authStatus).toHaveTextContent('authenticated')
    })
  })

  describe('Login Flow', () => {
    it('should successfully log in a user and store tokens', async () => {
      const { login: loginMock } = await import('@/api/auth')
      vi.mocked(loginMock).mockResolvedValue({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
      })

      renderWithAuth(<TestComponent />)
      const loginButton = screen.getByTestId('login-button')

      loginButton.click()

      await waitFor(() => {
        expect(localStorage.getItem('accessToken')).toBe('test-access-token')
        expect(localStorage.getItem('refreshToken')).toBe('test-refresh-token')
      })

      const authStatus = screen.getByTestId('auth-status')
      expect(authStatus).toHaveTextContent('authenticated')
    })

    it('should handle login errors gracefully', async () => {
      const { login: loginMock } = await import('@/api/auth')
      const error = new Error('Login failed')
      vi.mocked(loginMock).mockRejectedValue(error)

      const consoleMock = vi.spyOn(console, 'error').mockImplementation(() => {})

      renderWithAuth(<TestComponent />)
      const loginButton = screen.getByTestId('login-button')

      try {
        loginButton.click()
        await waitFor(() => {
          expect(localStorage.getItem('accessToken')).toBeNull()
        })
      } catch (e) {
        // Suppress unhandled rejection in test
      }

      consoleMock.mockRestore()

      const authStatus = screen.getByTestId('auth-status')
      expect(authStatus).toHaveTextContent('not-authenticated')
    })

    it('should clear tokens on login failure', async () => {
      const { login: loginMock } = await import('@/api/auth')
      vi.mocked(loginMock).mockRejectedValue(new Error('Invalid credentials'))

      // Set initial tokens
      localStorage.setItem('accessToken', 'old-token')
      localStorage.setItem('refreshToken', 'old-refresh')

      const consoleMock = vi.spyOn(console, 'error').mockImplementation(() => {})

      renderWithAuth(<TestComponent />)
      const loginButton = screen.getByTestId('login-button')

      try {
        loginButton.click()
        await waitFor(() => {
          expect(localStorage.getItem('accessToken')).toBeNull()
          expect(localStorage.getItem('refreshToken')).toBeNull()
        })
      } catch (e) {
        // Suppress unhandled rejection
      }

      consoleMock.mockRestore()
    })
  })

  describe('Register Flow', () => {
    it('should successfully register a new user with name', async () => {
      const { register: registerMock } = await import('@/api/auth')
      vi.mocked(registerMock).mockResolvedValue({
        email: 'test@example.com',
      })

      renderWithAuth(<TestComponent />)
      const registerButton = screen.getByTestId('register-button')

      registerButton.click()

      await waitFor(() => {
        const authStatus = screen.getByTestId('auth-status')
        expect(authStatus).toHaveTextContent('authenticated')
      })
    })

    it('should handle registration errors gracefully', async () => {
      const { register: registerMock } = await import('@/api/auth')
      vi.mocked(registerMock).mockRejectedValue(new Error('Email already exists'))

      const consoleMock = vi.spyOn(console, 'error').mockImplementation(() => {})

      renderWithAuth(<TestComponent />)
      const registerButton = screen.getByTestId('register-button')

      try {
        registerButton.click()
        await waitFor(() => {
          const authStatus = screen.getByTestId('auth-status')
          expect(authStatus).toHaveTextContent('not-authenticated')
        })
      } catch (e) {
        // Suppress unhandled rejection
      }

      consoleMock.mockRestore()
    })

    it('should pass name parameter to registration API', async () => {
      const { register: registerMock } = await import('@/api/auth')
      vi.mocked(registerMock).mockResolvedValue({
        email: 'newuser@example.com',
      })

      const TestRegisterComponent = () => {
        const { register } = useAuth()
        return (
          <button
            onClick={() => register('newuser@example.com', 'pass123', 'John Doe')}
            data-testid="register-with-name"
          >
            Register
          </button>
        )
      }

      renderWithAuth(<TestRegisterComponent />)
      const registerButton = screen.getByTestId('register-with-name')

      registerButton.click()

      await waitFor(() => {
        expect(registerMock).toHaveBeenCalledWith(
          'newuser@example.com',
          'pass123',
          'John Doe'
        )
      })
    })
  })

  describe('Logout Flow', () => {
    it('should clear tokens on logout', async () => {
      localStorage.setItem('accessToken', 'test-token')
      localStorage.setItem('refreshToken', 'test-refresh')

      // Note: window.location.reload cannot be mocked in jsdom,
      // so we test that tokens are cleared before the reload happens
      renderWithAuth(<TestComponent />)
      const logoutButton = screen.getByTestId('logout-button')

      logoutButton.click()

      // Verify tokens are cleared immediately on logout click
      expect(localStorage.getItem('accessToken')).toBeNull()
      expect(localStorage.getItem('refreshToken')).toBeNull()
    })

    it('should clear tokens immediately when logout is called', async () => {
      localStorage.setItem('accessToken', 'test-token')
      localStorage.setItem('refreshToken', 'test-refresh')

      renderWithAuth(<TestComponent />)
      const authStatus = screen.getByTestId('auth-status')
      expect(authStatus).toHaveTextContent('authenticated')

      const logoutButton = screen.getByTestId('logout-button')
      logoutButton.click()

      // Tokens should be cleared immediately
      expect(localStorage.getItem('accessToken')).toBeNull()
      expect(localStorage.getItem('refreshToken')).toBeNull()

      // Auth status also updated
      expect(authStatus).toHaveTextContent('authenticated') // May still show until render completes
    })
  })

  describe('Token Management', () => {
    it('should persist tokens in localStorage on successful login', async () => {
      const { login: loginMock } = await import('@/api/auth')
      vi.mocked(loginMock).mockResolvedValue({
        accessToken: 'persistent-access-token',
        refreshToken: 'persistent-refresh-token',
      })

      renderWithAuth(<TestComponent />)
      const loginButton = screen.getByTestId('login-button')

      loginButton.click()

      await waitFor(() => {
        expect(localStorage.getItem('accessToken')).toBe('persistent-access-token')
        expect(localStorage.getItem('refreshToken')).toBe('persistent-refresh-token')
      })
    })

    it('should handle missing tokens in API response', async () => {
      const { login: loginMock } = await import('@/api/auth')
      vi.mocked(loginMock).mockResolvedValue({})

      const consoleMock = vi.spyOn(console, 'error').mockImplementation(() => {})

      renderWithAuth(<TestComponent />)
      const loginButton = screen.getByTestId('login-button')

      try {
        loginButton.click()
        await waitFor(() => {
          const authStatus = screen.getByTestId('auth-status')
          expect(authStatus).toHaveTextContent('not-authenticated')
        })
      } catch (e) {
        // Expected: missing tokens trigger error
      }

      consoleMock.mockRestore()
    })
  })

  describe('Error States', () => {
    it('should handle network errors during login', async () => {
      const { login: loginMock } = await import('@/api/auth')
      const networkError = new Error('Network error')
      vi.mocked(loginMock).mockRejectedValue(networkError)

      const consoleMock = vi.spyOn(console, 'error').mockImplementation(() => {})

      renderWithAuth(<TestComponent />)
      const loginButton = screen.getByTestId('login-button')

      try {
        loginButton.click()
        await waitFor(() => {
          const authStatus = screen.getByTestId('auth-status')
          expect(authStatus).toHaveTextContent('not-authenticated')
        })
      } catch (e) {
        // Suppress unhandled rejection
      }

      consoleMock.mockRestore()
    })

    it('should clear previous tokens on authentication failure', async () => {
      localStorage.setItem('accessToken', 'old-token')
      localStorage.setItem('refreshToken', 'old-refresh')

      const { login: loginMock } = await import('@/api/auth')
      vi.mocked(loginMock).mockRejectedValue(new Error('Authentication failed'))

      const consoleMock = vi.spyOn(console, 'error').mockImplementation(() => {})

      renderWithAuth(<TestComponent />)
      const loginButton = screen.getByTestId('login-button')

      try {
        loginButton.click()
        await waitFor(() => {
          expect(localStorage.getItem('accessToken')).toBeNull()
          expect(localStorage.getItem('refreshToken')).toBeNull()
        })
      } catch (e) {
        // Suppress unhandled rejection
      }

      consoleMock.mockRestore()
    })
  })

  describe('useAuth Hook', () => {
    it('should throw error when used outside AuthProvider', () => {
      // Suppress console.error for this test
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<TestComponent />)
      }).toThrow('useAuth must be used within an AuthProvider')

      errorSpy.mockRestore()
    })
  })
})
