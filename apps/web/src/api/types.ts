// The signed-in user as login, refresh and invite accept return it (v2 responses have their types
// in @ecomanage/shared).

export interface SessionUser {
  _id: string
  email: string
  name?: string
  theme?: 'dark' | 'light' | null
}
