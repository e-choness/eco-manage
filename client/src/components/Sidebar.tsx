import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { 
  Home, 
  Activity, 
  BarChart3, 
  Zap, 
  Bell, 
  DollarSign, 
  Settings,
  Sun,
  Wind,
  Battery
} from "lucide-react"

const navigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Monitoring', href: '/monitoring', icon: Activity },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Optimization', href: '/optimization', icon: Zap },
  { name: 'Alerts', href: '/alerts', icon: Bell },
  { name: 'Financial', href: '/financial', icon: DollarSign },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  return (
    <div className="w-64 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-r border-slate-200 dark:border-slate-700">
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Sun className="h-6 w-6 text-yellow-500" />
              <Wind className="h-4 w-4 text-blue-500 absolute -top-1 -right-1" />
            </div>
            <Battery className="h-5 w-5 text-green-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">EnergyHub</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Renewable Energy</p>
          </div>
        </div>
        
        <nav className="flex-1 px-4 py-6 space-y-2">
          {navigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              end={item.href === '/'}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                  "hover:bg-slate-100 dark:hover:bg-slate-800",
                  isActive
                    ? "bg-gradient-to-r from-blue-500 to-green-500 text-white shadow-lg"
                    : "text-slate-700 dark:text-slate-300"
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}