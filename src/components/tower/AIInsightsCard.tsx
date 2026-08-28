import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lightbulb, Zap, AlertTriangle, CheckCircle, Loader2, Settings, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { API_BASE_URL, withDeviceHeaders } from "@/lib/tower-storage";

interface AIInsight {
  insights: string;
  recommendations: string[];
  healthScore: number;
  riskFactors: string[];
}

interface AIInsightsResponse extends Partial<AIInsight> {
  available?: boolean;
  error?: string;
  message?: string;
}

const ERR_GEMINI_NOT_CONFIGURED = "AI analysis unavailable - Gemini API not configured";
const ERR_NO_LIVE_STATUS = "No live data yet from ESP32";

export function AIInsightsCard({ deviceId }: { deviceId?: string | null }) {
  const [insights, setInsights] = useState<AIInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // API Key management states
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const loadSettings = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings`, withDeviceHeaders({ method: "GET" }));
      if (res.ok) {
        const data = await res.json();
        setApiKey(data.geminiApiKey || "");
      }
    } catch (e) {
      // Ignore errors during initial key check
    }
  };

  useEffect(() => {
    if (showSettings) {
      loadSettings();
    }
  }, [showSettings]);

  const handleSaveKey = async () => {
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings`, withDeviceHeaders({
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ geminiApiKey: apiKey })
      }));
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to save key");
      }
      toast.success("Gemini API Key saved successfully!");
      setShowSettings(false);
      fetchInsights();
    } catch (err: any) {
      setSettingsError(err.message || "Failed to save API key");
    } finally {
      setSavingSettings(false);
    }
  };

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai-insights?days=7`, withDeviceHeaders({ method: "GET" }, deviceId));
      const data = (await response.json().catch(() => null)) as AIInsightsResponse | null;

      if (data?.error) {
        if (data.error === "No status available") {
          setError(ERR_NO_LIVE_STATUS);
        } else if (data.error === "AI analysis unavailable") {
          setError(ERR_GEMINI_NOT_CONFIGURED);
        } else {
          setError(data.message ?? data.error);
        }
      } else if (response.ok && data) {
        setInsights(data as AIInsight);
        setLastUpdated(new Date().toLocaleTimeString());
      } else {
        setError("Failed to fetch AI insights");
      }
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
    const interval = setInterval(fetchInsights, 5 * 60 * 1000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, [deviceId]);

  const getHealthColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-amber-600";
    return "text-red-600";
  };

  const getHealthBgColor = (score: number) => {
    if (score >= 80) return "bg-green-50";
    if (score >= 60) return "bg-amber-50";
    return "bg-red-50";
  };

  if (error === ERR_NO_LIVE_STATUS) {
    return (
      <Card className="p-6 border-blue-200 bg-blue-50">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5" />
          <div>
            <div className="font-semibold text-blue-900">No Live Data Yet</div>
            <div className="text-sm text-blue-800 mt-1">
              AI insights need current sensor status from ESP32. Post telemetry to <code className="bg-blue-100 px-1 py-0.5 rounded">/api/status</code> and refresh.
            </div>
          </div>
        </div>
      </Card>
    );
  }

  if (error === ERR_GEMINI_NOT_CONFIGURED) {
    return (
      <Card className="p-6 border-amber-200 bg-amber-50">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
          <div>
            <div className="font-semibold text-amber-900">AI Insights Not Available</div>
            <div className="text-sm text-amber-800 mt-1">
              To enable AI-powered sensor analysis, add either Google AI Studio key to the <code className="bg-amber-100 px-1 py-0.5 rounded">.env.local</code> file:
            </div>
            <div className="mt-2 bg-white rounded p-2 text-xs font-mono text-amber-900">
              GOOGLE_AI_API_KEY=your_key_from_aistudio.google.com/app/apikeys<br />
              or<br />
              GEMINI_API_KEY=your_key_from_aistudio.google.com/app/apikeys
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">AI System Insights</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setShowSettings(!showSettings)}
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              title="Configure API Key"
            >
              <Settings className="h-4 w-4 text-slate-500" />
            </Button>
            <Button onClick={fetchInsights} disabled={loading} size="sm" variant="outline" className="h-8">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
            </Button>
          </div>
        </div>

        {showSettings && (
          <div className="bg-muted/40 p-4 rounded-lg border border-border/80 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b pb-2 mb-1">
              <span className="font-bold text-foreground">Configure Google Gemini AI Key</span>
              <Badge variant="outline" className="text-[10px]">Secure Storage</Badge>
            </div>
            
             <div className="space-y-1">
              <Label htmlFor="settings-apikey" className="text-[11px] font-bold">Gemini API Key</Label>
              <div className="relative">
                <Input
                  id="settings-apikey"
                  type={showKey ? "text" : "password"}
                  placeholder="AI Studio API Key (AIStudio.google.com)"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="h-8 text-xs font-mono pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-800"
                >
                  {showKey ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </div>

            {settingsError && (
              <p className="text-red-500 text-[10px] font-semibold">{settingsError}</p>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button onClick={() => setShowSettings(false)} size="sm" variant="ghost" className="h-7 text-xs font-semibold">
                Cancel
              </Button>
              <Button onClick={handleSaveKey} disabled={savingSettings} size="sm" className="h-7 text-xs bg-slate-800 text-white hover:bg-slate-700 font-bold px-3">
                {savingSettings ? "Saving..." : "Save API Key"}
              </Button>
            </div>
          </div>
        )}

        {loading && !insights && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Analyzing sensor data...</span>
          </div>
        )}

        {error && insights === null && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {insights && (
          <>
            {(insights as any).isHeuristic && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 p-3 flex items-center justify-between text-xs text-amber-700 dark:text-amber-400">
                <span className="font-semibold">Running on local agronomic heuristics.</span>
                <Button onClick={() => setShowSettings(true)} size="sm" variant="ghost" className="h-6 text-[10px] text-amber-800 dark:text-amber-400 font-bold underline hover:bg-transparent p-0">
                  Enable Gemini AI
                </Button>
              </div>
            )}
            {/* Health Score */}
            <div className={`rounded-lg p-4 ${getHealthBgColor(insights.healthScore)}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">System Health Score</div>
                  <div className={`text-3xl font-bold ${getHealthColor(insights.healthScore)}`}>
                    {insights.healthScore}%
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {insights.healthScore >= 80 ? (
                    <CheckCircle className="h-8 w-8 text-green-600" />
                  ) : insights.healthScore >= 60 ? (
                    <AlertTriangle className="h-8 w-8 text-amber-600" />
                  ) : (
                    <AlertTriangle className="h-8 w-8 text-red-600" />
                  )}
                </div>
              </div>
            </div>

            {/* Insights */}
            {insights.insights && (
              <div className="rounded-lg bg-blue-50 p-4 border border-blue-200">
                <div className="text-sm font-medium text-blue-900 mb-2">Key Observations</div>
                <div className="text-sm text-blue-800">{insights.insights}</div>
              </div>
            )}

            {/* Risk Factors */}
            {insights.riskFactors && insights.riskFactors.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Risk Factors
                </div>
                <div className="space-y-1">
                  {insights.riskFactors.map((risk, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                      <span className="text-muted-foreground">{risk}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {insights.recommendations && insights.recommendations.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-primary flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Recommendations
                </div>
                <div className="space-y-2">
                  {insights.recommendations.map((rec, idx) => (
                    <div key={idx} className="flex items-start gap-2 bg-secondary rounded p-2">
                      <Badge variant="outline" className="shrink-0 mt-0.5">
                        {idx + 1}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{rec}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {lastUpdated && (
              <div className="text-xs text-muted-foreground">Last updated: {lastUpdated}</div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
