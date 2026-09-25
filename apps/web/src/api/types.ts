// Response shapes of the current (v1) API, mirrored from apps/api route handlers.

export interface Alert {
  _id: string
  title: string
  message: string
  type: 'critical' | 'warning' | 'info'
  timestamp: string
  read: boolean
  resolved: boolean
}

export interface Recommendation {
  _id: string
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  estimatedSavings: number
  difficulty: 'easy' | 'medium' | 'hard'
  category: string
  status: 'pending' | 'accepted' | 'dismissed'
}

export interface SessionUser {
  _id: string
  email: string
  name?: string
}
