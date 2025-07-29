import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useNavigate } from "react-router-dom"
import {
  Sun,
  Wind,
  Battery,
  BarChart3,
  Zap,
  Leaf,
  TrendingUp,
  Shield,
  Users,
  Star
} from "lucide-react"

export function LandingPage() {
  const navigate = useNavigate()

  const features = [
    {
      icon: <BarChart3 className="h-6 w-6" />,
      title: "Real-time Monitoring",
      description: "Track your energy production and consumption in real-time with beautiful visualizations."
    },
    {
      icon: <Zap className="h-6 w-6" />,
      title: "Smart Optimization",
      description: "AI-powered recommendations to maximize your energy efficiency and savings."
    },
    {
      icon: <TrendingUp className="h-6 w-6" />,
      title: "Advanced Analytics",
      description: "Detailed reports and insights to understand your energy patterns and performance."
    },
    {
      icon: <Shield className="h-6 w-6" />,
      title: "Predictive Alerts",
      description: "Get notified about maintenance needs and system issues before they become problems."
    }
  ]

  const testimonials = [
    {
      name: "Sarah Johnson",
      role: "Homeowner",
      content: "EnergyHub helped me reduce my electricity bills by 60% and track my solar panel performance effortlessly.",
      rating: 5
    },
    {
      name: "Mike Chen",
      role: "Business Owner",
      content: "The analytics and optimization features have been game-changing for our commercial solar installation.",
      rating: 5
    },
    {
      name: "Emma Davis",
      role: "Environmental Enthusiast",
      content: "Love seeing my carbon footprint reduction in real-time. The app makes renewable energy management so simple!",
      rating: 5
    }
  ]

  const pricingTiers = [
    {
      name: "Basic",
      price: "$9.99",
      period: "/month",
      features: [
        "Up to 5 devices",
        "Basic monitoring",
        "Monthly reports",
        "Email support"
      ],
      popular: false
    },
    {
      name: "Pro",
      price: "$19.99",
      period: "/month",
      features: [
        "Up to 20 devices",
        "Real-time monitoring",
        "Advanced analytics",
        "Smart optimization",
        "Priority support"
      ],
      popular: true
    },
    {
      name: "Enterprise",
      price: "$49.99",
      period: "/month",
      features: [
        "Unlimited devices",
        "Custom integrations",
        "White-label options",
        "Dedicated support",
        "API access"
      ],
      popular: false
    }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-green-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Sun className="h-6 w-6 text-yellow-500" />
                <Wind className="h-4 w-4 text-blue-500" />
                <Battery className="h-5 w-5 text-green-500" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">EnergyHub</h1>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="ghost" onClick={() => navigate('/login')}>
                Login
              </Button>
              <Button onClick={() => navigate('/register')}>
                Get Started
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20">
        <div className="container mx-auto px-6 text-center">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-5xl font-bold text-slate-900 mb-6">
              Manage Your Renewable Energy
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-green-600"> Intelligently</span>
            </h1>
            <p className="text-xl text-slate-600 mb-8 leading-relaxed">
              Monitor, analyze, and optimize your solar panels, wind turbines, and battery storage
              with our comprehensive energy management platform.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button size="lg" className="bg-gradient-to-r from-blue-600 to-green-600 hover:from-blue-700 hover:to-green-700" onClick={() => navigate('/register')}>
                Start Free Trial
              </Button>
              <Button size="lg" variant="outline">
                Watch Demo
              </Button>
            </div>
          </div>

          {/* Animated Energy Icons */}
          <div className="mt-16 relative">
            <div className="flex items-center justify-center gap-8">
              <div className="animate-bounce delay-0">
                <div className="bg-yellow-100 p-4 rounded-full">
                  <Sun className="h-8 w-8 text-yellow-600" />
                </div>
              </div>
              <div className="animate-bounce delay-150">
                <div className="bg-blue-100 p-4 rounded-full">
                  <Wind className="h-8 w-8 text-blue-600" />
                </div>
              </div>
              <div className="animate-bounce delay-300">
                <div className="bg-green-100 p-4 rounded-full">
                  <Battery className="h-8 w-8 text-green-600" />
                </div>
              </div>
              <div className="animate-bounce delay-450">
                <div className="bg-purple-100 p-4 rounded-full">
                  <Zap className="h-8 w-8 text-purple-600" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white/50">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Powerful Features</h2>
            <p className="text-lg text-slate-600">Everything you need to maximize your renewable energy investment</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => (
              <Card key={index} className="bg-white/80 backdrop-blur-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                <CardHeader>
                  <div className="bg-gradient-to-r from-blue-100 to-green-100 p-3 rounded-full w-fit mb-4">
                    {feature.icon}
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-slate-600">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">What Our Users Say</h2>
            <p className="text-lg text-slate-600">Join thousands of satisfied customers saving money and the environment</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="bg-white/80 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center gap-1 mb-2">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <CardTitle className="text-lg">{testimonial.name}</CardTitle>
                  <p className="text-sm text-slate-500">{testimonial.role}</p>
                </CardHeader>
                <CardContent>
                  <p className="text-slate-600 italic">"{testimonial.content}"</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 bg-white/50">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Simple, Transparent Pricing</h2>
            <p className="text-lg text-slate-600">Choose the plan that fits your energy management needs</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {pricingTiers.map((tier, index) => (
              <Card key={index} className={`relative bg-white/80 backdrop-blur-sm ${tier.popular ? 'ring-2 ring-blue-500 scale-105' : ''}`}>
                {tier.popular && (
                  <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-blue-600 to-green-600">
                    Most Popular
                  </Badge>
                )}
                <CardHeader className="text-center">
                  <CardTitle className="text-2xl">{tier.name}</CardTitle>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">{tier.price}</span>
                    <span className="text-slate-500">{tier.period}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 mb-6">
                    {tier.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-center gap-2">
                        <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                        <span className="text-slate-600">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className={`w-full ${tier.popular ? 'bg-gradient-to-r from-blue-600 to-green-600 hover:from-blue-700 hover:to-green-700' : ''}`}
                    variant={tier.popular ? 'default' : 'outline'}
                    onClick={() => navigate('/register')}
                  >
                    Get Started
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-green-600">
        <div className="container mx-auto px-6 text-center">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold text-white mb-4">
              Ready to Optimize Your Energy Future?
            </h2>
            <p className="text-xl text-blue-100 mb-8">
              Join thousands of users who are already saving money and reducing their carbon footprint with EnergyHub.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button size="lg" className="bg-white text-blue-600 hover:bg-blue-50" onClick={() => navigate('/register')}>
                Start Your Free Trial
              </Button>
              <Button size="lg" variant="outline" className="border-white text-white hover:bg-white hover:text-blue-600">
                Contact Sales
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Sun className="h-6 w-6 text-yellow-500" />
                <h3 className="text-xl font-bold">EnergyHub</h3>
              </div>
              <p className="text-slate-400">
                Empowering the future of renewable energy management with intelligent monitoring and optimization.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-slate-400">
                <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-white transition-colors">API</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Integrations</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-slate-400">
                <li><a href="#" className="hover:text-white transition-colors">About</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-slate-400">
                <li><a href="#" className="hover:text-white transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 mt-8 pt-8 text-center text-slate-400">
            <p>&copy; 2024 EnergyHub. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}