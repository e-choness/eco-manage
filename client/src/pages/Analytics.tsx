import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getProductionAnalytics,
  getConsumptionAnalytics,
  getInsight
} from "@/api/analytics";
import { useToast } from "@/hooks/useToast";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
} from "recharts";
import { Download, TrendingUp, TrendingDown, Lightbulb, Loader2 } from "lucide-react";

export function Analytics() {
  const [productionData, setProductionData] = useState<any[]>([]);
  const [consumptionData, setConsumptionData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");
  const [aiInsight, setAiInsight] = useState("");
  const [detailedInsight, setDetailedInsight] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log("Fetching analytics data for period:", period);
        const [productionResult, consumptionResult] = await Promise.all([
          getProductionAnalytics(period),
          getConsumptionAnalytics(period),
        ]);

        setProductionData((productionResult as any).data);
        setConsumptionData((consumptionResult as any).data);
      } catch (error) {
        console.error("Error fetching analytics data:", error);
        toast({
          title: "Error",
          description: "Failed to load analytics data",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [period, toast]);

  const handleExport = () => {
    console.log("Exporting analytics data");
    toast({
      title: "Export Started",
      description:
        "Your analytics report is being generated and will be downloaded shortly.",
    });
  };

  const calculateTrend = (data: any[], key: string) => {
    if (data.length < 2) return 0;
    const recent = data.slice(-7).reduce((sum, item) => sum + item[key], 0) / 7;
    const previous =
      data.slice(-14, -7).reduce((sum, item) => sum + item[key], 0) / 7;
    return ((recent - previous) / previous) * 100;
  };

  const totalProduction = productionData.reduce(
    (sum, item) => sum + item.total,
    0
  );
  const totalConsumption = consumptionData.reduce(
    (sum, item) => sum + item.consumption,
    0
  );
  const productionTrend = calculateTrend(productionData, "total");
  const consumptionTrend = calculateTrend(consumptionData, "consumption");

  useEffect(() => {
    if (productionData.length > 0 && consumptionData.length > 0) {
      const insight = `Based on the current trends, your energy production is ${productionTrend.toFixed(
        1
      )}% ${
        productionTrend >= 0 ? "higher" : "lower"
      } and consumption is ${consumptionTrend.toFixed(1)}% ${
        consumptionTrend >= 0 ? "lower" : "higher"
      } than the previous period.`;
      setAiInsight(insight);
    }
  }, [productionData, consumptionData, productionTrend, consumptionTrend]);

  const handleGetInsight = async () => {
    setInsightLoading(true);
    setDetailedInsight("");
    try {
      const result = await getInsight({ productionData, consumptionData });
      console.log("Result:", result.insight);
      setDetailedInsight(result.insight); // Update with callback
    } catch (error) {
      console.error("Error getting detailed insight:", error);
      toast({
        title: "Error",
        description: "Failed to get detailed insight. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setInsightLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 bg-slate-200 rounded w-48 animate-pulse"></div>
          <div className="h-10 bg-slate-200 rounded w-32 animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-4 bg-slate-200 rounded w-3/4"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-slate-200 rounded w-1/2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
          Energy Analytics
        </h1>
        <div className="flex items-center gap-4">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="year">Year</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleExport} className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Total Production
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
              {totalProduction.toFixed(1)} kWh
            </div>
            <div className="flex items-center gap-1 text-sm">
              {productionTrend >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              <span
                className={
                  productionTrend >= 0 ? "text-green-600" : "text-red-600"
                }
              >
                {Math.abs(productionTrend).toFixed(1)}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300">
              Total Consumption
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-900 dark:text-green-100">
              {totalConsumption.toFixed(1)} kWh
            </div>
            <div className="flex items-center gap-1 text-sm">
              {consumptionTrend >= 0 ? (
                <TrendingUp className="h-4 w-4 text-red-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-green-600" />
              )}
              <span
                className={
                  consumptionTrend >= 0 ? "text-red-600" : "text-green-600"
                }
              >
                {Math.abs(consumptionTrend).toFixed(1)}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-purple-700 dark:text-purple-300">
              Net Energy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
              {(totalProduction - totalConsumption).toFixed(1)} kWh
            </div>
            <div className="text-sm text-purple-600 dark:text-purple-400">
              {totalProduction > totalConsumption ? "Surplus" : "Deficit"}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-orange-700 dark:text-orange-300">
              Efficiency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-900 dark:text-orange-100">
              {totalConsumption > 0
                ? ((totalProduction / totalConsumption) * 100).toFixed(1)
                : 0}
              %
            </div>
            <div className="text-sm text-orange-600 dark:text-orange-400">
              Production vs Consumption
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Insight Card */}
      {aiInsight && (
        <Card className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900/20 dark:to-gray-800/20">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
              <Lightbulb className="h-4 w-4 mr-2" />
              AI Insight
            </CardTitle>
            <Button onClick={handleGetInsight} size="sm" disabled={insightLoading}>
              {insightLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Get Detailed Insight"
              )}
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {aiInsight}
            </p>
            {insightLoading && (
              <div className="flex items-center justify-center mt-4">
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
              </div>
            )}
            {detailedInsight && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{detailedInsight}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <Tabs defaultValue="production" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="production">Production Analysis</TabsTrigger>
          <TabsTrigger value="consumption">Consumption Analysis</TabsTrigger>
          <TabsTrigger value="comparison">Comparison</TabsTrigger>
        </TabsList>

        <TabsContent value="production" className="space-y-6">
          <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Energy Production Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={productionData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="solar"
                    stackId="1"
                    stroke="#f59e0b"
                    fill="#fbbf24"
                  />
                  <Area
                    type="monotone"
                    dataKey="wind"
                    stackId="1"
                    stroke="#3b82f6"
                    fill="#60a5fa"
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="#10b981"
                    fill="none"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Production by Source</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={productionData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="solar" fill="#fbbf24" />
                  <Bar dataKey="wind" fill="#60a5fa" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consumption" className="space-y-6">
          <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Energy Consumption Pattern</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={consumptionData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="consumption"
                    stroke="#ef4444"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="comparison" className="space-y-6">
          <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Production vs Consumption</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={consumptionData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="production"
                    stroke="#10b981"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="consumption"
                    stroke="#ef4444"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
