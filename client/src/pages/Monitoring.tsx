import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { getDevices, addDevice } from "@/api/devices"
import { getEnergyFlow } from "@/api/dashboard"
import { useToast } from "@/hooks/useToast"
import { Plus, Sun, Wind, Battery, Zap, RefreshCw } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EnergyFlowDiagram } from "@/components/EnergyFlowDiagram"

export function Monitoring() {
  const [devices, setDevices] = useState<any[]>([])
  const [energyFlow, setEnergyFlow] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newDevice, setNewDevice] = useState({ name: '', type: '', maxOutput: '' })
  const { toast } = useToast()

  const fetchData = async () => {
    try {
      console.log('Fetching monitoring data')
      const [devicesData, flowData] = await Promise.all([
        getDevices(),
        getEnergyFlow()
      ])

      setDevices((devicesData as any).devices)
      setEnergyFlow(flowData)
    } catch (error) {
      console.error('Error fetching monitoring data:', error)
      toast({
        title: "Error",
        description: "Failed to load monitoring data",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchData()
  }

  const handleAddDevice = async () => {
    try {
      console.log('Adding new device')
      const result = await addDevice({
        name: newDevice.name,
        type: newDevice.type,
        maxOutput: parseFloat(newDevice.maxOutput)
      })

      toast({
        title: "Success",
        description: (result as any).message,
      })

      setDialogOpen(false)
      setNewDevice({ name: '', type: '', maxOutput: '' })
      await fetchData()
    } catch (error) {
      console.error('Error adding device:', error)
      toast({
        title: "Error",
        description: "Failed to add device",
        variant: "destructive",
      })
    }
  }

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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 bg-slate-200 rounded w-48 animate-pulse"></div>
          <div className="h-10 bg-slate-200 rounded w-32 animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-slate-200 rounded w-3/4"></div>
              </CardHeader>
              <CardContent>
                <div className="h-32 bg-slate-200 rounded"></div>
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
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Real-Time Monitoring</h1>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Device
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white dark:bg-slate-800">
              <DialogHeader>
                <DialogTitle>Add New Device</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Device Name</Label>
                  <Input
                    id="name"
                    value={newDevice.name}
                    onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })}
                    placeholder="Enter device name"
                  />
                </div>
                <div>
                  <Label htmlFor="type">Device Type</Label>
                  <Select value={newDevice.type} onValueChange={(value) => setNewDevice({ ...newDevice, type: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select device type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="solar">Solar Panel</SelectItem>
                      <SelectItem value="wind">Wind Turbine</SelectItem>
                      <SelectItem value="battery">Battery Storage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="maxOutput">Max Output (kW)</Label>
                  <Input
                    id="maxOutput"
                    type="number"
                    value={newDevice.maxOutput}
                    onChange={(e) => setNewDevice({ ...newDevice, maxOutput: e.target.value })}
                    placeholder="Enter max output"
                  />
                </div>
                <Button onClick={handleAddDevice} className="w-full">
                  Add Device
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Energy Flow Visualization */}
      {energyFlow && (
        <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Live Energy Flow</CardTitle>
          </CardHeader>
          <CardContent>
            <EnergyFlowDiagram data={energyFlow} />
          </CardContent>
        </Card>
      )}

      {/* Device Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {devices.map((device) => (
          <Card key={device._id} className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm hover:shadow-lg transition-all duration-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getDeviceIcon(device.type)}
                  <div>
                    <CardTitle className="text-lg">{device.name}</CardTitle>
                    <p className="text-sm text-muted-foreground capitalize">{device.type}</p>
                  </div>
                </div>
                <Badge className={`${getStatusColor(device.status)} text-white`}>
                  {device.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Current Output</span>
                  <span className="font-medium">{device.currentOutput} / {device.maxOutput} kW</span>
                </div>
                <Progress value={(device.currentOutput / device.maxOutput) * 100} className="h-2" />
              </div>
              
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Efficiency</span>
                  <span className="font-medium">{device.efficiency}%</span>
                </div>
                <Progress value={device.efficiency} className="h-2" />
              </div>

              <div className="pt-2 border-t">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Last Maintenance</span>
                  <span>{new Date(device.lastMaintenance).toLocaleDateString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {devices.length === 0 && (
        <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Zap className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Devices Found</h3>
            <p className="text-muted-foreground text-center mb-4">
              Get started by adding your first renewable energy device to monitor.
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Device
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}