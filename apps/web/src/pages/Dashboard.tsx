import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getDashboardOverview, getEnergyFlow } from "@/api/dashboard"
import type { DashboardOverview, EnergyFlow } from "@/api/types"
import { useToast } from "@/hooks/useToast"
import {
  Sun,
  Zap,
  TrendingUp,
  Leaf,
  Thermometer,
  Cloud
} from "lucide-react"
import { EnergyFlowDiagram } from "@/components/EnergyFlowDiagram"


const formatChange = (pct: number | null) =>
  pct === null ? 'No data from yesterday to compare' : `${pct > 0 ? '+' : ''}${pct}% vs same time yesterday`

export function Dashboard() {
  const [dashboardData, setDashboardData] = useState<DashboardOverview | null>(null)
  const [energyFlow, setEnergyFlow] = useState<EnergyFlow | null>(null)
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [overviewData, flowData] = await Promise.all([getDashboardOverview(), getEnergyFlow()])

        setDashboardData(overviewData)
        setEnergyFlow(flowData)
      } catch (error) {
        console.error('Error fetching dashboard data:', error)
        toast({
          title: "Error",
          description: "Failed to load dashboard data",
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [toast])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 bg-slate-200 rounded w-3/4"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-slate-200 rounded w-1/2 mb-2"></div>
                <div className="h-3 bg-slate-200 rounded w-full"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (!dashboardData || !energyFlow) return null

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'optimal': return 'bg-green-500'
      case 'warning': return 'bg-yellow-500'
      case 'critical': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const getWeatherIcon = (condition: string) => {
    switch (condition) {
      case 'sunny': return <Sun className="h-5 w-5 text-yellow-500" />
      case 'cloudy': return <Cloud className="h-5 w-5 text-gray-500" />
      default: return <Sun className="h-5 w-5 text-yellow-500" />
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Dashboard Overview</h1>
        <Badge className={`${getStatusColor(dashboardData.systemStatus)} text-white`}>
          System {dashboardData.systemStatus}
        </Badge>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-blue-200 dark:border-blue-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-300">Current Power</CardTitle>
            <Zap className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">{dashboardData.currentPower} kW</div>
            <p className="text-xs text-blue-600 dark:text-blue-400">Real-time generation</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-green-200 dark:border-green-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300">Today's Production</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-900 dark:text-green-100">{dashboardData.todayProduction} kWh</div>
            <p className="text-xs text-green-600 dark:text-green-400">{formatChange(dashboardData.productionChangePct)}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border-purple-200 dark:border-purple-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-purple-700 dark:text-purple-300">Total Savings</CardTitle>
            <TrendingUp className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">${dashboardData.savings}</div>
            <p className="text-xs text-purple-600 dark:text-purple-400">Last 30 days (est. $0.12/kWh)</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20 border-emerald-200 dark:border-emerald-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Carbon Offset</CardTitle>
            <Leaf className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{dashboardData.carbonOffsetKg} kg</div>
            <p className="text-xs text-emerald-600 dark:text-emerald-400">CO₂ avoided, last 30 days</p>
          </CardContent>
        </Card>
      </div>

      {/* Weather and System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {getWeatherIcon(dashboardData.weatherCondition)}
              Weather Conditions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{dashboardData.temperature}°C</p>
                <p className="text-sm text-muted-foreground capitalize">{dashboardData.weatherCondition}</p>
              </div>
              <Thermometer className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Energy Flow</CardTitle>
          </CardHeader>
          <CardContent>
            <EnergyFlowDiagram data={energyFlow} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}