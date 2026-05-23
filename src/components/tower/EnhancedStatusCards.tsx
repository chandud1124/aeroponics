import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, AlertCircle, Droplet, Thermometer, Zap, AlertOctagon } from "lucide-react";
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

        {/* Flow Status */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Flow</span>
            <Droplet className="h-5 w-5 text-blue-500" />
          </div>
          <div className="mt-2">
            <Badge variant={status.flowing ? "default" : "secondary"}>
              {status.flowing ? "Flowing" : "No flow"}
            </Badge>
          </div>
        </Card>

        {/* Reservoir Temperature */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Res. Temp</span>
            <Thermometer className="h-5 w-5 text-orange-500" />
          </div>
          <div className="mt-2 text-xl font-semibold">
            {status.reservoirTempC !== null ? (
              <>
                {status.reservoirTempC.toFixed(1)}
                <span className="text-sm text-muted-foreground">°C</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">N/A</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {status.reservoirTempC !== null && status.reservoirTempC >= 25
              ? "⚠ High - consider shading"
              : status.reservoirTempC !== null && status.reservoirTempC < 15
                ? "⚠ Cold - slows growth"
                : "✓ Optimal"}
          </p>
        </Card>

        {/* Tower Temperature */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Tower Temp</span>
            <Thermometer className="h-5 w-5 text-green-500" />
          </div>
          <div className="mt-2 text-xl font-semibold">
            {status.towerTempC !== null ? (
              <>
                {status.towerTempC.toFixed(1)}
                <span className="text-sm text-muted-foreground">°C</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">N/A</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {status.towerTempC !== null && status.towerTempC >= 30
              ? "⚠ Very hot"
              : status.towerTempC !== null && status.towerTempC < 12
                ? "⚠ Cold"
                : "✓ Good"}
          </p>
        </Card>
      </div>

      {/* Water Level */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <span className="font-medium">Water Sensor</span>
          <Droplet className="h-5 w-5 text-blue-500" />
        </div>
        <div className="mt-3 rounded border border-dashed border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
          No water level sensor installed right now.
        </div>
      </Card>

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
