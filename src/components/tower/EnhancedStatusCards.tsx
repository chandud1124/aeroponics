import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, AlertCircle, Zap, AlertOctagon, Activity, Thermometer, Droplets, Gauge, Sprout } from "lucide-react";
import { parseFault, FAULT_INFO, type FaultCode } from "@/lib/tower-faults";
import type { LiveStatus } from "@/lib/tower-storage";

interface StatusCardsProps {
  status: LiveStatus;
}

function FaultAlert({ fault }: { fault: string | null }) {
  if (!fault || fault === "OK") return null;

  const code = parseFault(fault) as FaultCode;
  const info = FAULT_INFO[code];
  if (!info) return null;

  const Icon =
    info.severity === "bad" ? AlertOctagon : info.severity === "warn" ? AlertTriangle : AlertCircle;

  const alertVariant = info.severity === "bad" ? "destructive" : "default";

  return (
    <Alert variant={alertVariant} className="mb-4">
      <Icon className="h-4 w-4" />
      <AlertDescription>
        <strong>{info.label}</strong> — {info.hint}
      </AlertDescription>
    </Alert>
  );
}

export function EnhancedStatusCards({ status }: StatusCardsProps) {
  const getPhStatus = (ph: number | null | undefined) => {
    if (ph === null || ph === undefined) return { variant: "secondary" as const, label: "Offline", color: "text-muted-foreground" };
    if (ph >= 5.5 && ph <= 6.5) return { variant: "default" as const, label: `${ph.toFixed(2)} pH`, color: "text-emerald-500 font-semibold" };
    return { variant: "destructive" as const, label: `${ph.toFixed(2)} pH`, color: "text-amber-500 font-semibold animate-pulse" };
  };

  const getEcStatus = (ec: number | null | undefined) => {
    if (ec === null || ec === undefined) return { variant: "secondary" as const, label: "Offline", color: "text-muted-foreground" };
    if (ec >= 0.8 && ec <= 1.6) return { variant: "default" as const, label: `${ec.toFixed(2)} mS/cm`, color: "text-emerald-500 font-semibold" };
    return { variant: "destructive" as const, label: `${ec.toFixed(2)} mS/cm`, color: "text-amber-500 font-semibold animate-pulse" };
  };

  const getWaterLevelColor = (level: string | null) => {
    if (!level) return "bg-slate-200 text-slate-900";
    if (level === "LOW") return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400";
    if (level === "MEDIUM") return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400";
    return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400";
  };

  const isDosingActive = status.phDosingOn || status.nutritionADosingOn || status.nutritionBDosingOn;

  return (
    <div className="space-y-4">
      {/* Fault Alert */}
      <FaultAlert fault={status.fault} />

      {/* Main Status Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        {/* Pump Status */}
        <Card className="p-4 sm:p-5 flex flex-col justify-between border-border/85 bg-card/65 shadow-sm hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">Irrigation Pump</span>
            <Activity className={`h-5 w-5 ${status.pumpOn ? "text-emerald-500 animate-spin" : "text-muted-foreground"}`} style={{ animationDuration: '3s' }} />
          </div>
          <div className="mt-4">
            <div className="text-2xl font-bold tracking-tight">
              {status.pumpOn ? "RUNNING" : "STANDBY"}
            </div>
            <div className="mt-1">
              <Badge variant={status.pumpOn ? "default" : "secondary"}>
                {status.flowing ? "Water Flow OK" : "No Flow"}
              </Badge>
            </div>
          </div>
        </Card>

        {/* pH Card */}
        <Card className="p-4 sm:p-5 flex flex-col justify-between border-border/85 bg-card/65 shadow-sm hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">pH Level</span>
            <Gauge className="h-5 w-5 text-indigo-500" />
          </div>
          <div className="mt-4">
            <div className={`text-2xl font-bold tracking-tight ${getPhStatus(status.ph).color}`}>
              {status.ph != null ? status.ph.toFixed(2) : "——"}
            </div>
            <div className="mt-1">
              <Badge variant={getPhStatus(status.ph).variant}>
                {status.ph != null && status.ph >= 5.5 && status.ph <= 6.5 ? "Ideal Range" : "Needs Adjust"}
              </Badge>
            </div>
          </div>
        </Card>

        {/* EC Card */}
        <Card className="p-4 sm:p-5 flex flex-col justify-between border-border/85 bg-card/65 shadow-sm hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">EC Conductivity</span>
            <Activity className="h-5 w-5 text-amber-500" />
          </div>
          <div className="mt-4">
            <div className={`text-2xl font-bold tracking-tight ${getEcStatus(status.ec).color}`}>
              {status.ec != null ? `${status.ec.toFixed(2)}` : "——"}
            </div>
            <div className="mt-1">
              <Badge variant={getEcStatus(status.ec).variant}>
                {status.ec != null && status.ec >= 0.8 && status.ec <= 1.6 ? "Ideal Range" : "Needs Nutrition"}
              </Badge>
            </div>
          </div>
        </Card>

        {/* Water Temp & Level Card */}
        <Card className="p-4 sm:p-5 flex flex-col justify-between border-border/85 bg-card/65 shadow-sm hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">Water Temperatures</span>
            <Thermometer className="h-5 w-5 text-sky-500" />
          </div>
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">Tank Temp:</span>
              <span className="font-bold text-foreground">{status.reservoirTempC != null ? `${status.reservoirTempC.toFixed(1)}°C` : "——"}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">NFT Temp:</span>
              <span className="font-bold text-foreground">{status.nftTempC != null ? `${status.nftTempC.toFixed(1)}°C` : "——"}</span>
            </div>
            <div className="mt-2 pt-1 border-t border-border/40">
              <Badge className={`border ${getWaterLevelColor(status.waterLevel)}`}>
                Level: {status.waterLevel ?? "UNKNOWN"}
              </Badge>
            </div>
          </div>
        </Card>

        {/* Humidity Card */}
        <Card className="p-4 sm:p-5 flex flex-col justify-between border-border/85 bg-card/65 shadow-sm hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">Air Humidity</span>
            <Droplets className="h-5 w-5 text-sky-400" />
          </div>
          <div className="mt-4">
            <div className="text-2xl font-bold tracking-tight">
              {status.humidityPct != null ? `${status.humidityPct.toFixed(1)} %` : "——"}
            </div>
            <div className="mt-1">
              <Badge variant={status.dhtOk ? "default" : "secondary"}>
                {status.dhtOk ? "DHT22 Active" : "DHT22 Error"}
              </Badge>
            </div>
          </div>
        </Card>

        {/* Vapor Pressure Deficit (VPD) Card */}
        <Card className="p-4 sm:p-5 flex flex-col justify-between border-border/85 bg-card/65 shadow-sm hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">Vapor Deficit (VPD)</span>
            <Sprout className="h-5 w-5 text-emerald-500 animate-pulse" />
          </div>
          <div className="mt-4">
            <div className="text-2xl font-bold tracking-tight">
              {status.vpd != null ? `${status.vpd.toFixed(2)} kPa` : "——"}
            </div>
            <div className="mt-1">
              <Badge variant={
                status.vpd == null 
                  ? "secondary" 
                  : status.vpd >= 0.8 && status.vpd <= 1.2 
                  ? "default" 
                  : "destructive"
              }>
                {status.vpd == null 
                  ? "Offline" 
                  : status.vpd >= 0.8 && status.vpd <= 1.2 
                  ? "Optimal" 
                  : status.vpd < 0.8 
                  ? "Low Trans." 
                  : "High Trans."
                }
              </Badge>
            </div>
          </div>
        </Card>

        {/* System & Dosing Status */}
        <Card className="p-4 sm:p-5 flex flex-col justify-between border-border/85 bg-card/65 shadow-sm hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">Dosing Status</span>
            <Zap className={`h-5 w-5 ${isDosingActive ? "text-amber-400 animate-pulse" : "text-emerald-500"}`} />
          </div>
          <div className="mt-4">
            <div className="text-xl font-bold tracking-tight">
              {isDosingActive ? "DOSING..." : "IDLE"}
            </div>
            <div className="mt-1">
              <Badge variant={isDosingActive ? "destructive" : "outline"}>
                {status.phDosingOn ? "pH Down On" : status.nutritionADosingOn ? "Nutrients On" : "All Pumps Off"}
              </Badge>
            </div>
          </div>
        </Card>
      </div>

      {/* Last Run & Status Details */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {status.lastRunISO && (
          <Card className="p-4 bg-muted/30 border-border/80 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider block">Last irrigation cycle</span>
              <span className="mt-1 text-sm font-semibold block text-foreground">
                {new Date(status.lastRunISO).toLocaleString()}
              </span>
            </div>
            <Badge variant="outline" className="text-xs">
              {Math.round((Date.now() - new Date(status.lastRunISO).getTime()) / 60000)}m ago
            </Badge>
          </Card>
        )}
        <Card className="p-4 bg-muted/30 border-border/80 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider block">Closed-Loop Automation</span>
            <span className="mt-1 text-sm font-semibold block text-emerald-500">
              Active: pH & EC monitoring enabled
            </span>
          </div>
          <Badge variant="outline" className="text-xs">
            ESP32 Local
          </Badge>
        </Card>
      </div>
    </div>
  );
}

