import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getOptimizationRecommendations, acceptRecommendation } from "@/api/optimization"
import { useToast } from "@/hooks/useToast"
import { CheckCircle, XCircle, TrendingUp, Zap, Sun, Wind, Battery, DollarSign } from "lucide-react"

export function Optimization() {
  const [recommendations, setRecommendations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    const fetchRecommendations = async () => {
      try {
        console.log('Fetching optimization recommendations')
        const result = await getOptimizationRecommendations()
        setRecommendations((result as any).recommendations)
      } catch (error) {
        console.error('Error fetching recommendations:', error)
        toast({
          title: "Error",
          description: "Failed to load optimization recommendations",
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    }

    fetchRecommendations()
  }, [toast])

  const handleAcceptRecommendation = async (recommendationId: string) => {
    try {
      console.log('Accepting recommendation:', recommendationId)
      await acceptRecommendation(recommendationId)
      
      setRecommendations(prev => 
        prev.filter(rec => rec._id !== recommendationId)
      )

      toast({
        title: "Recommendation Accepted",
        description: "The optimization has been scheduled for implementation.",
      })
    } catch (error) {
      console.error('Error accepting recommendation:', error)
      toast({
        title: "Error",
        description: "Failed to accept recommendation",
        variant: "destructive",
      })
    }
  }

  const handleDismissRecommendation = (recommendationId: string) => {
    console.log('Dismissing recommendation:', recommendationId)
    setRecommendations(prev => 
      prev.filter(rec => rec._id !== recommendationId)
    )
    toast({
      title: "Recommendation Dismissed",
      description: "The recommendation has been removed from your list.",
    })
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-500'
      case 'medium': return 'bg-yellow-500'
      case 'low': return 'bg-green-500'
      default: return 'bg-gray-500'
    }
  }

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'easy': return 'text-green-600 bg-green-100'
      case 'medium': return 'text-yellow-600 bg-yellow-100'
      case 'hard': return 'text-red-600 bg-red-100'
      default: return 'text-gray-600 bg-gray-100'
    }
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'solar': return <Sun className="h-5 w-5 text-yellow-500" />
      case 'wind': return <Wind className="h-5 w-5 text-blue-500" />
      case 'battery': return <Battery className="h-5 w-5 text-green-500" />
      case 'consumption': return <Zap className="h-5 w-5 text-purple-500" />
      default: return <TrendingUp className="h-5 w-5 text-gray-500" />
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-slate-200 rounded w-64 animate-pulse"></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-slate-200 rounded w-3/4"></div>
                <div className="h-4 bg-slate-200 rounded w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-4 bg-slate-200 rounded"></div>
                  <div className="h-4 bg-slate-200 rounded w-5/6"></div>
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
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Energy Optimization</h1>
        <Badge variant="outline" className="text-sm">
          {recommendations.length} recommendations
        </Badge>
      </div>

      {recommendations.length === 0 ? (
        <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">All Optimized!</h3>
            <p className="text-muted-foreground text-center">
              Your energy system is running optimally. Check back later for new recommendations.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {recommendations.map((recommendation) => (
            <Card key={recommendation._id} className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm hover:shadow-lg transition-all duration-200">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {getCategoryIcon(recommendation.category)}
                    <div>
                      <CardTitle className="text-lg">{recommendation.title}</CardTitle>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={`${getPriorityColor(recommendation.priority)} text-white text-xs`}>
                          {recommendation.priority} priority
                        </Badge>
                        <Badge variant="outline" className={`${getDifficultyColor(recommendation.difficulty)} text-xs`}>
                          {recommendation.difficulty}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-slate-600 dark:text-slate-300">
                  {recommendation.description}
                </p>

                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <DollarSign className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      Estimated Monthly Savings
                    </p>
                    <p className="text-lg font-bold text-green-900 dark:text-green-100">
                      ${recommendation.estimatedSavings}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    onClick={() => handleAcceptRecommendation(recommendation._id)}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-green-600 hover:from-blue-700 hover:to-green-700"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleDismissRecommendation(recommendation._id)}
                    className="flex-1"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Dismiss
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Optimization Tips */}
      <Card className="bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-900/20 dark:to-green-900/20 border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            Optimization Tips
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-semibold text-blue-800 dark:text-blue-200">Peak Production Hours</h4>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Schedule high-energy activities between 11 AM - 3 PM when solar production is highest.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-green-800 dark:text-green-200">Battery Management</h4>
              <p className="text-sm text-green-700 dark:text-green-300">
                Keep battery charge between 20-80% for optimal lifespan and performance.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-purple-800 dark:text-purple-200">Weather Awareness</h4>
              <p className="text-sm text-purple-700 dark:text-purple-300">
                Monitor weather forecasts to adjust energy usage patterns accordingly.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-orange-800 dark:text-orange-200">Regular Maintenance</h4>
              <p className="text-sm text-orange-700 dark:text-orange-300">
                Clean solar panels monthly and service wind turbines quarterly for peak efficiency.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}