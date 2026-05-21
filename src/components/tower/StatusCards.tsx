import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Droplets,
  Thermometer,
  Sprout,
  Activity,
  Gauge,
  Clock,
  AlertTriangle,
  AlertOctagon,
  AlertCircle,
  Zap,
} from "lucide-react";
import type { LiveStatus } from "@/lib/tower-storage";
import { parseFault, FAULT_INFO, type FaultCode } from "@/lib/tower-faults";

function StatusCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClasses = {
    default: "border-border",
    good: "border-primary/40 bg-primary/5",
    warn: "border-accent/60 bg-accent/10",
    bad: "border-destructive/40 bg-destructive/5",
  }[tone];
  return (
    <Card className={`p-5 ${toneClasses}`}>
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-primary">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
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

export function StatusCards({ status }: { status: LiveStatus }) {
  const levelTone =
    status.waterLevel === "LOW" ? "bad" : status.waterLevel === "FULL" ? "good" : "warn";
  return (
    <div className="space-y-4">
      <FaultAlert fault={status.fault} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatusCard
          icon={<Activity className="h-5 w-5" />}
          label="Pump"
          value={
            <Badge variant={status.pumpOn ? "default" : "secondary"}>
              {status.pumpOn ? "RUNNING" : "IDLE"}
            </Badge>
          }
          hint={status.pumpOn ? "Cycle in progress" : "Waiting for next schedule"}
          tone={status.pumpOn ? "good" : "default"}
        />
        <StatusCard
          icon={<Droplets className="h-5 w-5" />}
          label="Water flow"
          value={
            <Badge variant={status.flowing ? "default" : "secondary"}>
              {status.flowing ? "OK" : "NO FLOW"}
            </Badge>
          }
          hint="YF-S201 flow sensor"
          tone={status.flowing ? "good" : status.pumpOn ? "bad" : "default"}
        />
        <StatusCard
          icon={<Gauge className="h-5 w-5" />}
          label="Water level"
          value={status.waterLevel}
          hint="3-probe conductivity"
          tone={levelTone}
        />
        <StatusCard
          icon={<Thermometer className="h-5 w-5" />}
          label="Reservoir temp"
          value={status.reservoirTempC != null ? `${status.reservoirTempC.toFixed(1)} °C` : "Waiting for ESP32"}
          hint={status.reservoirTempC != null ? "DS18B20 in tank" : "Sensor offline or device not yet connected"}
        />
        <StatusCard
          icon={<Droplets className="h-5 w-5" />}
          label="Humidity"
          value={status.humidityPct != null ? `${Math.round(status.humidityPct)} %` : "Waiting for ESP32"}
          hint={status.humidityPct != null ? "DHT sensor" : "Sensor offline or device not yet connected"}
        />
        <StatusCard
          icon={<Sprout className="h-5 w-5" />}
          label="Tower / root zone"
          value={status.towerTempC != null ? `${status.towerTempC.toFixed(1)} °C` : "Waiting for ESP32"}
          hint={status.towerTempC != null ? "DS18B20 in tower" : "Sensor offline or device not yet connected"}
        />
        <StatusCard
          icon={<Clock className="h-5 w-5" />}
          label="Last pump run"
          value={
            status.lastRunISO
              ? new Date(status.lastRunISO).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
                : "No cycle yet"
          }
            hint={status.lastRunISO ? new Date(status.lastRunISO).toLocaleDateString() : "Waiting for first automated cycle"}
        />
        {(() => {
          const code = parseFault(status.fault);
          if (!code || code === "OK") return null;
          const info = FAULT_INFO[code];
          const cls =
            info.severity === "bad"
              ? "border-destructive/50 bg-destructive/5"
              : info.severity === "warn"
                ? "border-accent/60 bg-accent/10"
                : "border-border";
          const titleCls =
            info.severity === "bad"
              ? "text-destructive"
              : info.severity === "warn"
                ? "text-accent-foreground"
                : "";
          return (
            <Card className={`col-span-full p-5 ${cls}`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className={`h-5 w-5 ${titleCls}`} />
                <div className="flex-1">
                  <div className={`flex items-center gap-2 font-semibold ${titleCls}`}>
                    {info.label}
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {code}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">{info.hint}</div>
                </div>
              </div>
            </Card>
          );
        })()}
        <StatusCard
          icon={<Zap className="h-5 w-5" />}
          label="Grow light"
          value={
            <Badge variant={status.lightOn ? "default" : "secondary"}>
              {status.lightOn ? "ON" : "OFF"}
            </Badge>
          }
          hint="LED grow light relay"
          tone={status.lightOn ? "good" : "default"}
        />
      </div>
    </div>
  );
}
