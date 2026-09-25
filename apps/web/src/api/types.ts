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

export interface EnergyFlow {
  solar: number
  wind: number
  battery: number
  consumption: number
  // Positive when importing from the grid, negative when exporting
  grid: number
  timestamp: string | null
}

export interface DashboardOverview {
  totalProduction: number
  currentPower: number
  dailyProduction: number
  monthlyProduction: number
  todayProduction: number
  productionChangePct: number | null
  systemStatus: 'optimal' | 'warning' | 'critical' | 'unknown'
  weatherCondition: string
  temperature: number
  savings: number
  carbonOffsetKg: number
}

export interface ProductionPoint {
  date: string
  solar: number
  wind: number
  total: number
}

export interface ConsumptionPoint {
  date: string
  consumption: number
}

export interface FinancialOverview {
  totalSavings: number
  monthlyRevenue: number
  roi: number
  paybackPeriod: number
  maintenanceCosts: number
}

export interface FinancialHistoryItem {
  id: string
  date: string
  savings: number
  revenue: number
  costs: number
  category: string
}

export interface SessionUser {
  _id: string
  email: string
  name?: string
}
