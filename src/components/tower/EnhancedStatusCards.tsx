import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, AlertCircle, Zap, AlertOctagon } from "lucide-react";
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
  return (
    <div className="space-y-4">
      {/* Fault Alert */}
      <FaultAlert fault={status.fault} />

      {/* Main Status Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Pump Status */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Pump</span>
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-2">
            <Badge variant={status.pumpOn ? "default" : "secondary"}>
              {status.pumpOn ? "ON" : "OFF"}
            </Badge>
          </div>
        </Card>

        {/* Light Status */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Light</span>
            <Zap className="h-5 w-5 text-amber-500" />
          </div>
          <div className="mt-2">
            <Badge variant={status.lightOn ? "default" : "secondary"}>
              {status.lightOn ? "ON" : "OFF"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">Time-based light control</p>
        </Card>

        {/* Humidity */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Humidity</span>
            <Zap className="h-5 w-5 text-sky-500" />
          </div>
          <div className="mt-2">
            <Badge variant={status.dhtOk ? "default" : "secondary"}>
              {status.humidityPct != null ? `${status.humidityPct.toFixed(1)} %` : "Waiting"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">From DHT22 humidity sensor</p>
        </Card>

        {/* Sensor Health */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Sensor health</span>
            <Zap className="h-5 w-5 text-green-500" />
          </div>
          <div className="mt-2">
            <Badge variant={status.sensorDataOk ? "default" : "secondary"}>
              {status.sensorDataOk ? "OK" : "Degraded"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">Only humidity + light are active</p>
        </Card>
      </div>

      {/* Last Run */}
      {status.lastRunISO && (
        <Card className="p-4 sm:p-5">
          <span className="text-sm text-muted-foreground">Last pump cycle</span>
          <div className="mt-2 text-sm font-medium">
            {new Date(status.lastRunISO).toLocaleString()}
          </div>
          <p className="text-xs text-muted-foreground">
            {Math.round((Date.now() - new Date(status.lastRunISO).getTime()) / 60000)} minutes ago
          </p>
        </Card>
      )}
    </div>
  );
}
