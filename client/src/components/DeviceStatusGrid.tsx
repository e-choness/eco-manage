import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Sun, Wind, Battery, Zap } from "lucide-react"

interface Device {
  _id: string
  name: string
  type: string
  status: string
  currentOutput: number
  maxOutput: number
  efficiency: number
  lastMaintenance: string
}

interface DeviceStatusGridProps {
  devices: Device[]
}

export function DeviceStatusGrid({ devices }: DeviceStatusGridProps) {
  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'solar': return <Sun className="h-5 w-5 text-yellow-500" />
      case 'wind': return <Wind className="h-5 w-5 text-blue-500" />
      case 'battery': return <Battery className="h-5 w-5 text-green-500" />
      default: return <Zap className="h-5 w-5 text-purple-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500'
      case 'offline': return 'bg-red-500'
      case 'charging': return 'bg-blue-500'
      case 'warning': return 'bg-yellow-500'
      default: return 'bg-gray-500'
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {devices.map((device) => (
        <Card key={device._id} className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                {getDeviceIcon(device.type)}
                <span className="truncate">{device.name}</span>
              </div>
              <Badge className={`${getStatusColor(device.status)} text-white text-xs`}>
                {device.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Output</span>
                <span>{device.currentOutput}/{device.maxOutput} kW</span>
              </div>
              <Progress value={(device.currentOutput / device.maxOutput) * 100} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Efficiency</span>
                <span>{device.efficiency}%</span>
              </div>
              <Progress value={device.efficiency} className="h-2" />
            </div>
            <div className="text-xs text-muted-foreground">
              Last maintenance: {new Date(device.lastMaintenance).toLocaleDateString()}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}