import { Battery, Sun, Wind, Home, Zap } from "lucide-react"

interface EnergyFlowData {
  solar: number
  wind: number
  battery: number
  grid: number
  consumption: number
}

interface EnergyFlowDiagramProps {
  data: EnergyFlowData
}

export function EnergyFlowDiagram({ data }: EnergyFlowDiagramProps) {
  return (
    <div className="relative h-64 flex items-center justify-center">
      {/* Solar */}
      <div className="absolute top-4 left-8 flex flex-col items-center">
        <div className="bg-yellow-100 dark:bg-yellow-900/30 p-3 rounded-full mb-2">
          <Sun className="h-6 w-6 text-yellow-600" />
        </div>
        <span className="text-sm font-medium">{data.solar} kW</span>
        <span className="text-xs text-muted-foreground">Solar</span>
      </div>

      {/* Wind */}
      <div className="absolute top-4 right-8 flex flex-col items-center">
        <div className="bg-blue-100 dark:bg-blue-900/30 p-3 rounded-full mb-2">
          <Wind className="h-6 w-6 text-blue-600" />
        </div>
        <span className="text-sm font-medium">{data.wind} kW</span>
        <span className="text-xs text-muted-foreground">Wind</span>
      </div>

      {/* Battery */}
      <div className="absolute bottom-4 left-8 flex flex-col items-center">
        <div className="bg-green-100 dark:bg-green-900/30 p-3 rounded-full mb-2">
          <Battery className="h-6 w-6 text-green-600" />
        </div>
        <span className="text-sm font-medium">{data.battery} kW</span>
        <span className="text-xs text-muted-foreground">Battery</span>
      </div>

      {/* Grid */}
      <div className="absolute bottom-4 right-8 flex flex-col items-center">
        <div className="bg-purple-100 dark:bg-purple-900/30 p-3 rounded-full mb-2">
          <Zap className="h-6 w-6 text-purple-600" />
        </div>
        <span className="text-sm font-medium">{data.grid} kW</span>
        <span className="text-xs text-muted-foreground">Grid</span>
      </div>

      {/* Home/Consumption - Center */}
      <div className="flex flex-col items-center">
        <div className="bg-slate-100 dark:bg-slate-700 p-4 rounded-full mb-2">
          <Home className="h-8 w-8 text-slate-600 dark:text-slate-300" />
        </div>
        <span className="text-lg font-bold">{data.consumption} kW</span>
        <span className="text-sm text-muted-foreground">Consumption</span>
      </div>

      {/* Flow Lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {/* Solar to Home */}
        <line x1="25%" y1="25%" x2="50%" y2="50%" stroke="currentColor" strokeWidth="2" className="text-yellow-500 opacity-60" />
        {/* Wind to Home */}
        <line x1="75%" y1="25%" x2="50%" y2="50%" stroke="currentColor" strokeWidth="2" className="text-blue-500 opacity-60" />
        {/* Battery to Home */}
        <line x1="25%" y1="75%" x2="50%" y2="50%" stroke="currentColor" strokeWidth="2" className="text-green-500 opacity-60" />
        {/* Grid to Home */}
        <line x1="75%" y1="75%" x2="50%" y2="50%" stroke="currentColor" strokeWidth="2" className="text-purple-500 opacity-60" />
      </svg>
    </div>
  )
}