import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { fetchSensorHistory, type LiveStatus, type SensorSnapshot } from "@/lib/tower-storage";
import { format } from "date-fns";
import { Activity, Thermometer, Gauge, Zap } from "lucide-react";

interface DashboardChartsProps {
  deviceId: string | null;
  status?: LiveStatus | null;
  onViewHistory?: () => void;
}

export function DashboardCharts({ deviceId, status, onViewHistory }: DashboardChartsProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const currentPoint = status
    ? [{
        timestamp: Date.now(),
        timeLabel: format(Date.now(), "HH:mm"),
        ph: status.ph,
        ec: status.ec,
        reservoirTempC: status.reservoirTempC,
        nftTempC: status.nftTempC,
        humidityPct: status.humidityPct,
      }]
    : [];

  useEffect(() => {
    if (!deviceId) {
      setData(currentPoint);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchSensorHistory(1, deviceId)
      .then((history) => {
        if (history && history.length > 0) {
          const formatted = history.map((pt) => ({
            timestamp: pt.timestamp,
            timeLabel: format(pt.timestamp, "HH:mm"),
            ph: pt.ph,
            ec: pt.ec,
            reservoirTempC: pt.reservoirTempC,
            nftTempC: pt.nftTempC,
            humidityPct: pt.humidityPct,
            isSimulated: false,
          }));
          setData(formatted);
        } else {
          setData(currentPoint);
        }
      })
      .catch(() => {
        setData(currentPoint);
      })
      .finally(() => setLoading(false));
  }, [deviceId, status]);

  const hasHistory = data.length > 1;
  const latest = data.at(-1);
  const formatValue = (value: number | null | undefined, suffix = "") =>
    value == null ? "--" : `${value.toFixed(1)}${suffix}`;

  return (
    <div className="space-y-4">

      <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-xs sm:text-sm font-bold text-foreground truncate">Sensor pulse</h3>
          <p className="text-[10px] sm:text-[11px] text-muted-foreground line-clamp-1">Last 24h · {hasHistory ? "live" : "loading"}</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {onViewHistory && (
            <button
              onClick={onViewHistory}
              className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-primary hover:underline whitespace-nowrap"
            >
              Details →
            </button>
          )}
          <span className="inline-flex items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span className={`h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full ${loading ? "animate-pulse bg-amber-500" : "bg-emerald-500"}`} />
            <span className="hidden xs:inline">{loading ? "Syncing" : hasHistory ? "Live" : "Snap"}</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
      {/* pH and EC Trend Area Chart */}
      <Card
        onClick={onViewHistory}
        className={`flex min-w-0 flex-col justify-between border-border/80 bg-card/80 p-3 sm:p-4 shadow-sm transition-colors ${
          onViewHistory ? "cursor-pointer hover:border-primary/50 hover:bg-card/90" : "hover:border-primary/30"
        }`}
      >
        <div className="space-y-1 mb-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-indigo-500 flex-shrink-0" />
              <span className="line-clamp-1">pH & EC Balance</span>
            </span>
            <span className="text-[8px] sm:text-[9px] font-bold text-muted-foreground whitespace-nowrap">pH 5.5–6.5</span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-muted-foreground block line-clamp-2">Acid level and EC index.</span>
        </div>

        <div className="h-40 w-full xs:h-48 sm:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorPh" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorEc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
              <XAxis dataKey="timeLabel" className="text-[8px] xs:text-[9px] sm:text-[10px] font-semibold fill-muted-foreground" tickLine={false} minTickGap={20} />
              <YAxis yAxisId="left" domain={[5.0, 7.0]} className="text-[8px] xs:text-[9px] font-mono fill-muted-foreground" tickLine={false} width={30} />
              <YAxis yAxisId="right" orientation="right" domain={[0.6, 1.8]} className="text-[8px] xs:text-[9px] font-mono fill-muted-foreground" tickLine={false} width={30} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "6px", fontSize: "10px" }}
                labelStyle={{ fontWeight: "bold" }}
              />
              <Legend wrapperStyle={{ fontSize: "9px", fontWeight: "bold", paddingTop: "8px" }} />
              <Area yAxisId="left" type="monotone" dataKey="ph" name="pH" stroke="#6366f1" strokeWidth={1.5} fillOpacity={1} fill="url(#colorPh)" />
              <Area yAxisId="right" type="monotone" dataKey="ec" name="EC" stroke="#f59e0b" strokeWidth={1.5} fillOpacity={1} fill="url(#colorEc)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Temperature and Humidity Trend Chart */}
      <Card
        onClick={onViewHistory}
        className={`flex min-w-0 flex-col justify-between border-border/80 bg-card/80 p-3 sm:p-4 shadow-sm transition-colors ${
          onViewHistory ? "cursor-pointer hover:border-primary/50 hover:bg-card/90" : "hover:border-primary/30"
        }`}
      >
        <div className="space-y-1 mb-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Thermometer className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-sky-500 flex-shrink-0" />
              <span className="line-clamp-1">Temp & Humidity</span>
            </span>
            <span className="text-[8px] sm:text-[9px] font-bold text-muted-foreground whitespace-nowrap">40–90%</span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-muted-foreground block line-clamp-2">Environmental conditions.</span>
        </div>

        <div className="h-40 w-full xs:h-48 sm:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorNftTemp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorHum" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
              <XAxis dataKey="timeLabel" className="text-[8px] xs:text-[9px] sm:text-[10px] font-semibold fill-muted-foreground" tickLine={false} minTickGap={20} />
              <YAxis yAxisId="left" domain={[15, 30]} className="text-[8px] xs:text-[9px] font-mono fill-muted-foreground" tickLine={false} width={30} />
              <YAxis yAxisId="right" orientation="right" domain={[40, 90]} className="text-[8px] xs:text-[9px] font-mono fill-muted-foreground" tickLine={false} width={30} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "6px", fontSize: "10px" }}
                labelStyle={{ fontWeight: "bold" }}
              />
              <Legend wrapperStyle={{ fontSize: "9px", fontWeight: "bold", paddingTop: "8px" }} />
              <Area yAxisId="left" type="monotone" dataKey="reservoirTempC" name="Tank T°" stroke="#0ea5e9" strokeWidth={1.5} fillOpacity={1} fill="url(#colorTemp)" />
              <Area yAxisId="left" type="monotone" dataKey="nftTempC" name="NFT T°" stroke="#f59e0b" strokeWidth={1.5} fillOpacity={1} fill="url(#colorNftTemp)" />
              <Area yAxisId="right" type="monotone" dataKey="humidityPct" name="Humidity %" stroke="#22c55e" strokeWidth={1.5} fillOpacity={1} fill="url(#colorHum)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
      </div>
    </div>
  );
}
