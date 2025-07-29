import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getAlerts, markAlertAsRead } from "@/api/alerts"
import { useToast } from "@/hooks/useToast"
import { AlertTriangle, Info, AlertCircle, CheckCircle, Clock, Filter } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function Alerts() {
  const [alerts, setAlerts] = useState<any[]>([])
  const [filteredAlerts, setFilteredAlerts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const { toast } = useToast()

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        console.log('Fetching alerts')
        const result = await getAlerts()
        setAlerts((result as any).alerts)
        setFilteredAlerts((result as any).alerts)
      } catch (error) {
        console.error('Error fetching alerts:', error)
        toast({
          title: "Error",
          description: "Failed to load alerts",
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    }

    fetchAlerts()
  }, [toast])

  useEffect(() => {
    let filtered = alerts
    if (filter === 'unread') {
      filtered = alerts.filter(alert => !alert.read)
    } else if (filter === 'critical') {
      filtered = alerts.filter(alert => alert.type === 'critical')
    } else if (filter === 'resolved') {
      filtered = alerts.filter(alert => alert.resolved)
    }
    setFilteredAlerts(filtered)
  }, [alerts, filter])

  const handleMarkAsRead = async (alertId: string) => {
    try {
      console.log('Marking alert as read:', alertId)
      await markAlertAsRead(alertId)

      setAlerts(prev =>
        prev.map(alert =>
          alert._id === alertId ? { ...alert, read: true } : alert
        )
      )

      toast({
        title: "Alert Updated",
        description: "Alert marked as read",
      })
    } catch (error) {
      console.error('Error marking alert as read:', error)
      toast({
        title: "Error",
        description: "Failed to update alert",
        variant: "destructive",
      })
    }
  }

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'critical': return <AlertCircle className="h-5 w-5 text-red-500" />
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-500" />
      case 'info': return <Info className="h-5 w-5 text-blue-500" />
      default: return <Info className="h-5 w-5 text-gray-500" />
    }
  }

  const getAlertColor = (type: string) => {
    switch (type) {
      case 'critical': return 'border-l-red-500 bg-red-50 dark:bg-red-900/20'
      case 'warning': return 'border-l-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
      case 'info': return 'border-l-blue-500 bg-blue-50 dark:bg-blue-900/20'
      default: return 'border-l-gray-500 bg-gray-50 dark:bg-gray-900/20'
    }
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))

    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours}h ago`
    return date.toLocaleDateString()
  }

  const unreadCount = alerts.filter(alert => !alert.read).length
  const criticalCount = alerts.filter(alert => alert.type === 'critical').length

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 bg-slate-200 rounded w-48 animate-pulse"></div>
          <div className="h-10 bg-slate-200 rounded w-32 animate-pulse"></div>
        </div>
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="h-5 w-5 bg-slate-200 rounded"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                    <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Alerts & Notifications</h1>
          <div className="flex items-center gap-4 mt-2">
            <Badge variant="outline" className="text-sm">
              {unreadCount} unread
            </Badge>
            {criticalCount > 0 && (
              <Badge className="bg-red-500 text-white text-sm">
                {criticalCount} critical
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Alerts</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filteredAlerts.length === 0 ? (
        <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Alerts</h3>
            <p className="text-muted-foreground text-center">
              {filter === 'all' ? 'All systems are running smoothly!' : `No ${filter} alerts found.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredAlerts.map((alert) => (
            <Card key={alert._id} className={`border-l-4 ${getAlertColor(alert.type)} ${!alert.read ? 'ring-2 ring-blue-200 dark:ring-blue-800' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {getAlertIcon(alert.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900 dark:text-white">
                          {alert.title}
                          {!alert.read && (
                            <Badge className="ml-2 bg-blue-500 text-white text-xs">New</Badge>
                          )}
                        </h3>
                        <p className="text-slate-600 dark:text-slate-300 mt-1">
                          {alert.message}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        {alert.resolved && (
                          <Badge className="bg-green-500 text-white text-xs">
                            Resolved
                          </Badge>
                        )}
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          {formatTimestamp(alert.timestamp)}
                        </div>
                      </div>
                    </div>
                    {!alert.read && (
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleMarkAsRead(alert._id)}
                        >
                          Mark as Read
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}