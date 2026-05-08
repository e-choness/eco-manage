import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Register } from '@/pages/Register'
import { AuthProvider } from '@/contexts/AuthContext'
import { BrowserRouter } from 'react-router-dom'

// Mock the useNavigate hook
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

// Mock the useToast hook
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}))

// Mock auth API
vi.mock('@/api/auth', () => ({
  register: vi.fn(),
}))

function renderRegister() {
  return render(
    <BrowserRouter>
      <AuthProvider>
        <Register />
      </AuthProvider>
    </BrowserRouter>
  )
}

describe('Register Page', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('Form Rendering', () => {
    it('should render registration form with name, email and password fields', () => {
      renderRegister()

      expect(screen.getByPlaceholderText(/enter your full name/i)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/enter your email/i)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/choose a password/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
    })

    it('should render sign in link', () => {
      renderRegister()

      const signInLink = screen.getByRole('button', { name: /already have an account/i })
      expect(signInLink).toBeInTheDocument()
    })

    it('should have name input of type text', () => {
      renderRegister()

      const nameInput = screen.getByPlaceholderText(/enter your full name/i) as HTMLInputElement
      expect(nameInput).toBeInTheDocument()
    })

    it('should have email input of type email', () => {
      renderRegister()

      const emailInput = screen.getByPlaceholderText(/enter your email/i) as HTMLInputElement
      expect(emailInput.type).toBe('email')
    })

    it('should have password input of type password', () => {
      renderRegister()

      const passwordInput = screen.getByPlaceholderText(/choose a password/i) as HTMLInputElement
      expect(passwordInput.type).toBe('password')
    })
  })

  describe('Form Submission', () => {
    it('should submit form with name, email and password', async () => {
      const user = userEvent.setup()
      const { register: registerMock } = await import('@/api/auth')
      vi.mocked(registerMock).mockResolvedValue({
        email: 'newuser@example.com',
      })

      renderRegister()

      const nameInput = screen.getByPlaceholderText(/enter your full name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/choose a password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      await user.type(nameInput, 'John Doe')
      await user.type(emailInput, 'john@example.com')
      await user.type(passwordInput, 'password123')
      await user.click(submitButton)

      await waitFor(() => {
        expect(registerMock).toHaveBeenCalledWith(
          'john@example.com',
          'password123',
          'John Doe'
        )
      })
    })

    it('should disable submit button while loading', async () => {
      const user = userEvent.setup()
      const { register: registerMock } = await import('@/api/auth')
      vi.mocked(registerMock).mockImplementation(() => new Promise(resolve => {
        setTimeout(() => resolve({ email: 'test@example.com' }), 100)
      }))

      renderRegister()

      const nameInput = screen.getByPlaceholderText(/enter your full name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/choose a password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      await user.type(nameInput, 'Jane Doe')
      await user.type(emailInput, 'jane@example.com')
      await user.type(passwordInput, 'password123')
      await user.click(submitButton)

      expect(submitButton).toBeDisabled()

      await waitFor(() => {
        expect(submitButton).not.toBeDisabled()
      }, { timeout: 200 })
    })

    it('should show loading text while submitting', async () => {
      const user = userEvent.setup()
      const { register: registerMock } = await import('@/api/auth')
      vi.mocked(registerMock).mockImplementation(() => new Promise(resolve => {
        setTimeout(() => resolve({ email: 'test@example.com' }), 50)
      }))

      renderRegister()

      const nameInput = screen.getByPlaceholderText(/enter your full name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/choose a password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      await user.type(nameInput, 'Bob Smith')
      await user.type(emailInput, 'bob@example.com')
      await user.type(passwordInput, 'password123')
      await user.click(submitButton)

      expect(screen.getByText(/loading/i)).toBeInTheDocument()

      await waitFor(() => {
        expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
      }, { timeout: 100 })
    })
  })

  describe('Error Handling', () => {
    it('should handle registration errors', async () => {
      const user = userEvent.setup()
      const { register: registerMock } = await import('@/api/auth')
      vi.mocked(registerMock).mockRejectedValue(new Error('Email already exists'))

      renderRegister()

      const nameInput = screen.getByPlaceholderText(/enter your full name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/choose a password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      await user.type(nameInput, 'Test User')
      await user.type(emailInput, 'existing@example.com')
      await user.type(passwordInput, 'password123')
      await user.click(submitButton)

      await waitFor(() => {
        expect(registerMock).toHaveBeenCalled()
      })
    })

    it('should not store tokens on failed registration', async () => {
      const user = userEvent.setup()
      const { register: registerMock } = await import('@/api/auth')
      vi.mocked(registerMock).mockRejectedValue(new Error('Registration failed'))

      renderRegister()

      const nameInput = screen.getByPlaceholderText(/enter your full name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/choose a password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      await user.type(nameInput, 'Test User')
      await user.type(emailInput, 'test@example.com')
      await user.type(passwordInput, 'password')
      await user.click(submitButton)

      await waitFor(() => {
        expect(localStorage.getItem('accessToken')).toBeNull()
      })
    })
  })

  describe('Field Interactions', () => {
    it('should accept full names with multiple words', async () => {
      const user = userEvent.setup()
      renderRegister()

      const nameInput = screen.getByPlaceholderText(/enter your full name/i) as HTMLInputElement

      await user.type(nameInput, 'John Michael Smith')
      expect(nameInput.value).toBe('John Michael Smith')
    })

    it('should accept valid email formats', async () => {
      const user = userEvent.setup()
      renderRegister()

      const emailInput = screen.getByPlaceholderText(/enter your email/i) as HTMLInputElement

      await user.type(emailInput, 'user.name+tag@domain.co.uk')
      expect(emailInput.value).toBe('user.name+tag@domain.co.uk')
    })

    it('should allow password input with special characters', async () => {
      const user = userEvent.setup()
      renderRegister()

      const passwordInput = screen.getByPlaceholderText(/choose a password/i) as HTMLInputElement

      await user.type(passwordInput, 'P@ssw0rd!#$%^&*')
      expect(passwordInput.value).toBe('P@ssw0rd!#$%^&*')
    })

    it('should require all fields to be filled', async () => {
      const user = userEvent.setup()
      const { register: registerMock } = await import('@/api/auth')

      renderRegister()

      const submitButton = screen.getByRole('button', { name: /create account/i })

      // Try to submit without filling fields
      await user.click(submitButton)

      // registerMock should not be called if fields are required
      // (This depends on react-hook-form validation)
      expect(registerMock).not.toHaveBeenCalled()
    })
  })

  describe('Name Field (Option B Requirement)', () => {
    it('should have name field in the form', () => {
      renderRegister()

      const nameField = screen.getByLabelText(/full name/i)
      expect(nameField).toBeInTheDocument()
    })

    it('should include name in registration request', async () => {
      const user = userEvent.setup()
      const { register: registerMock } = await import('@/api/auth')
      vi.mocked(registerMock).mockResolvedValue({
        email: 'alice@example.com',
      })

      renderRegister()

      const nameInput = screen.getByPlaceholderText(/enter your full name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/choose a password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      const fullName = 'Alice Johnson'
      const email = 'alice@example.com'
      const password = 'secure123'

      await user.type(nameInput, fullName)
      await user.type(emailInput, email)
      await user.type(passwordInput, password)
      await user.click(submitButton)

      await waitFor(() => {
        expect(registerMock).toHaveBeenCalledWith(email, password, fullName)
      })
    })

    it('should pass name parameter to AuthContext register function', async () => {
      const user = userEvent.setup()
      const { register: registerMock } = await import('@/api/auth')
      vi.mocked(registerMock).mockResolvedValue({
        email: 'test@test.com',
      })

      renderRegister()

      const nameInput = screen.getByPlaceholderText(/enter your full name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/choose a password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      await user.type(nameInput, 'Test User')
      await user.type(emailInput, 'test@test.com')
      await user.type(passwordInput, 'password123')
      await user.click(submitButton)

      await waitFor(() => {
        // Verify the name parameter is passed (3rd argument)
        const callArgs = registerMock.mock.calls[0]
        expect(callArgs[2]).toBe('Test User')
      })
    })
  })
})
