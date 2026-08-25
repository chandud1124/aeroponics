import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/error-boundary";
import { EnhancedStatusCards } from "@/components/tower/EnhancedStatusCards";
import { ScheduleEditor } from "@/components/tower/ScheduleEditor";
import { GpioConfigTab } from "@/components/tower/GpioConfigTab";
import { DashboardCharts } from "@/components/tower/DashboardCharts";
import { NutritionTab } from "@/components/tower/NutritionTab";
import { NftChannelsTab } from "@/components/tower/NftChannelsTab";
import { DeviceRegistryTab } from "@/components/tower/DeviceRegistryTab";
import { ManualReadings } from "@/components/tower/ManualReadings";
import { Documentation } from "@/components/tower/Documentation";
import { PumpStats } from "@/components/tower/PumpStats";
import { AIInsightsCard } from "@/components/tower/AIInsightsCard";
import { VisualAiCameraTab } from "@/components/tower/VisualAiCameraTab";
import {
  defaultSchedule,
  fetchDevices,
  fetchSchedule,
  fetchStatusEnvelope,
  fetchNftChannels,
  fetchHarvestHistory,
  type LiveStatus,
  type Schedule,
  type DeviceListEntry,
  type NftChannel,
  type HarvestHistoryEntry,
} from "@/lib/tower-storage";
import {
  FaultAlertBanner,
  FaultHistoryPanel,
  LiveCycleHistoryPanel,
  ManualControlPanel,
  NextCyclePanel,
  PumpStateDisplay,
  RelayStatesCard,
} from "@/components/tower/PumpOperational";
import { HistoryAnalyticsTab } from "@/components/tower/HistoryAnalytics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { 
  Sprout, 
  LayoutDashboard, 
  Cpu, 
  Clock, 
  BarChart3, 
  Zap, 
  BookOpen, 
  FileText, 
  Grid, 
  Droplet, 
  FlaskConical, 
  Warehouse, 
  LineChart, 
  Flame, 
  ShieldAlert, 
  Calendar,
  AlertTriangle,
  History,
  TrendingUp,
  Settings,
  Plus,
  Trash2,
  Camera,
} from "lucide-react";

type NurseryTray = {
  id: string;
  name: string;
  crop: string;
  plantedOn: string;
  plugs: number;
  germinated: number;
  status: "empty" | "growing" | "ready";
};

const DEFAULT_NURSERY_TRAYS: NurseryTray[] = [
  { id: "tray-1", name: "Tray 1", crop: "", plantedOn: "", plugs: 30, germinated: 0, status: "empty" },
  { id: "tray-2", name: "Tray 2", crop: "", plantedOn: "", plugs: 30, germinated: 0, status: "empty" },
];

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "PolyHouse ERP — IoT Hydroponic Dashboard" },
      {
        name: "description",
        content:
          "Designer-grade ESP32 IoT operations center for commercial and gravity-fed vertical aeroponic systems.",
      },
    ],
    links: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
  }),
});

function Index() {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState("status");
  const [devices, setDevices] = useState<DeviceListEntry[]>([]);
  const [nftChannels, setNftChannels] = useState<NftChannel[]>([]);
  const [harvestHistory, setHarvestHistory] = useState<HarvestHistoryEntry[]>([]);
  const [loadingCrops, setLoadingCrops] = useState(true);
  const [nurseryTrays, setNurseryTrays] = useState<NurseryTray[]>(DEFAULT_NURSERY_TRAYS);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("polyhouse-nursery-trays");
      if (saved) setNurseryTrays(JSON.parse(saved) as NurseryTray[]);
    } catch {
      // Keep the default trays when local storage is unavailable or invalid.
    }
  }, []);

  useEffect(() => {
    if (mounted) localStorage.setItem("polyhouse-nursery-trays", JSON.stringify(nurseryTrays));
  }, [mounted, nurseryTrays]);

  const updateNurseryTray = (id: string, patch: Partial<NurseryTray>) => {
    setNurseryTrays((trays) => trays.map((tray) => (tray.id === id ? { ...tray, ...patch } : tray)));
  };

  const addNurseryTray = () => {
    const nextNumber = nurseryTrays.length + 1;
    setNurseryTrays((trays) => [
      ...trays,
      { id: `tray-${Date.now()}`, name: `Tray ${nextNumber}`, crop: "", plantedOn: "", plugs: 30, germinated: 0, status: "empty" },
    ]);
  };

  const loadCropsData = () => {
    setLoadingCrops(true);
    Promise.all([
      fetchNftChannels(),
      fetchHarvestHistory()
    ]).then(([chans, hist]) => {
      setNftChannels(chans || []);
      setHarvestHistory(hist || []);
    }).catch(() => {
      // ignore
    }).finally(() => setLoadingCrops(false));
  };

  useEffect(() => {
    if (activeTab === "crops") {
      loadCropsData();
    }
  }, [activeTab]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [schedule, setSchedule] = useState<Schedule>(defaultSchedule);
  const [hasRegisteredDevice, setHasRegisteredDevice] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetchDevices().then((d) => {
      if (d) {
        setDevices(d);
        if (!selectedDeviceId && d[0]?.deviceId) setSelectedDeviceId(d[0].deviceId);
      }
    });
    fetchSchedule().then((s) => s && setSchedule(s));
  }, [selectedDeviceId]);

  const activeDeviceId = selectedDeviceId.trim() || status?.deviceId || null;
  const backendReachable = status !== null;
  const telemetryFresh = status
    ? Date.now() - (status.telemetryUpdatedAt ?? status.heartbeatUpdatedAt ?? 0) < 300000
    : false;
  const controlsAllowed = hasRegisteredDevice && backendReachable;
  const liveStatus = status;

  // Find active water level sensor configuration calibration
  const currentDevice = devices.find((d) => d.deviceId === activeDeviceId);
  const waterPin = currentDevice?.pins?.find(
    (p) => p.type === "Water Level - Ultrasonic" || p.type === "Water Level - Analog Sensor"
  );
  const tankCapacity = waterPin?.tankCapacityLiters ?? 200;
  const emptyDistance = waterPin?.emptyDistanceCm ?? 50;
  const fullDistance = waterPin?.fullDistanceCm ?? 10;

  useEffect(() => {
    if (!mounted) return;
    const requestDeviceId = selectedDeviceId.trim() || "__current__";

    const fetchEnvelope = () => {
      fetchStatusEnvelope(requestDeviceId).then((payload) => {
        setStatus(payload?.status ?? null);
        setHasRegisteredDevice(Boolean(payload?.hasRegisteredDevice));
      });
    };

    fetchEnvelope();
    const interval = setInterval(fetchEnvelope, 2000);
    return () => clearInterval(interval);
  }, [mounted, selectedDeviceId]);

  useEffect(() => {
    if (!mounted) return;
    fetchDevices().then((d) => d && setDevices(d));
  }, [mounted, activeTab]);

  const navItems = [
    { id: "status", label: "Dashboard", icon: LayoutDashboard },
    { id: "controls", label: "Controls", icon: Settings },
    { id: "crops", label: "Crops Manager", icon: Sprout, badge: "3 Active" },
    { id: "nft", label: "NFT Channels", icon: Grid },
    { id: "nursery", label: "Nursery Trays", icon: Warehouse },
    { id: "water", label: "Reservoir & Water", icon: Droplet },
    { id: "nutrition", label: "Nutrition Dosing", icon: FlaskConical },
    { id: "devices", label: "Hardware Remapper", icon: Cpu, badge: String(devices.length) },
    { id: "plan", label: "Watering Plan", icon: Clock },
    { id: "stats", label: "Irrigation Stats", icon: BarChart3 },
    { id: "ai", label: "AI Insights", icon: Zap },
    { id: "camera", label: "Visual AI Camera", icon: Camera },
    { id: "readings", label: "Manual logs", icon: FileText },
  ];

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background flex">
        {/* Designer Sidebar */}
        <aside className="w-64 bg-card border-r border-border flex-col justify-between shrink-0 hidden md:flex sticky top-0 h-screen z-10">
          <div className="p-5 space-y-6 overflow-y-auto">
            {/* Branding Header */}
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <Sprout className="h-5 w-5 text-emerald-300 animate-pulse" />
              </div>
              <div>
                <h1 className="text-sm font-bold tracking-tight text-foreground">PolyHouse ERP</h1>
                <span className="text-[10px] text-muted-foreground block font-medium">IoT Operations Center</span>
              </div>
            </div>

            {/* Nav list */}
            <nav className="space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                    activeTab === item.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                      activeTab === item.id ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Scope selection */}
          <div className="p-4 border-t border-border/80 bg-muted/10 space-y-2">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">Scoped Hardware Node</span>
            <Select value={selectedDeviceId || "__current__"} onValueChange={(value) => setSelectedDeviceId(value === "__current__" ? "" : value)}>
              <SelectTrigger className="h-8 text-[11px] font-medium w-full">
                <SelectValue placeholder="Scope..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__current__" className="text-xs">Follow active stream</SelectItem>
                {devices.map((device) => (
                  <SelectItem key={device.deviceId} value={device.deviceId} className="text-xs">
                    {device.name ?? device.deviceId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-[9px] text-muted-foreground font-mono text-center">
              Active: {activeDeviceId ?? "default"}
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Mobile Bar */}
          <header className="border-b border-border bg-card md:hidden p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sprout className="h-5 w-5 text-primary" />
              <span className="text-sm font-bold">PolyHouse ERP</span>
            </div>
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="w-40 h-8 text-xs">
                <SelectValue placeholder="Module..." />
              </SelectTrigger>
              <SelectContent>
                {navItems.map((item) => (
                  <SelectItem key={item.id} value={item.id} className="text-xs">
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </header>

          <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col space-y-5 overflow-visible p-4 sm:p-6 md:space-y-6 md:p-8">
            
            {/* Dashboard tab */}
            {activeTab === "status" && (
              <div className="space-y-6">
                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Operational Overview</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Real-time status envelope and automated irrigation logs.</p>
                  </div>
                  <Badge variant={backendReachable ? "default" : "destructive"}>
                    {backendReachable ? "System Connected" : "API Offline"}
                  </Badge>
                </div>

                {status && (
                  <Card className={`border p-4 ${status.fault && status.fault !== "OK" && status.fault !== "NONE" ? "border-destructive/30 bg-destructive/5" : !telemetryFresh ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/25 bg-emerald-500/5"}`}>
                    <div className="flex items-start gap-3">
                      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${status.fault && status.fault !== "OK" && status.fault !== "NONE" ? "text-destructive" : !telemetryFresh ? "text-amber-500" : "text-emerald-500"}`} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">
                          {status.fault && status.fault !== "OK" && status.fault !== "NONE" ? `Attention needed: ${status.fault}` : !telemetryFresh ? "Controller is not sending recent readings" : status.waterLevel === "LOW" ? "Reservoir water is low" : status.ph != null && (status.ph < 5.5 || status.ph > 6.5) ? "pH needs attention" : status.ec != null && (status.ec < 0.8 || status.ec > 1.6) ? "EC needs attention" : "Farm is running normally"}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {status.fault && status.fault !== "OK" && status.fault !== "NONE" ? "Check the pump, water line, and controller before resuming automatic watering." : !telemetryFresh ? "Check the ESP32 connection. The last values remain visible below." : status.waterLevel === "LOW" ? "Refill the reservoir before the next irrigation cycle." : "No immediate action is required."}
                        </p>
                      </div>
                    </div>
                  </Card>
                )}

                {!backendReachable ? (
                  <div className="space-y-4">
                    <Card className="border-dashed p-6 text-center text-muted-foreground">
                      <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2 animate-bounce" />
                      <span className="font-semibold block text-sm">Local Server API Offline</span>
                      <span className="text-xs block mt-1">Please start the node backend or check system network configuration.</span>
                    </Card>
                  </div>
                ) : (
                  <>
                    {!telemetryFresh ? (
                      <Card className="border-dashed p-4 border-amber-500/25 bg-amber-500/5 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">Microcontroller Telemetry Interrupted</div>
                          <div className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                            The ESP32 is not posting diagnostics right now. Relay overrides remain available.
                          </div>
                        </div>
                        <Badge variant="destructive">OFFLINE</Badge>
                      </Card>
                    ) : (
                      <FaultAlertBanner status={status!} />
                    )}

                    <NextCyclePanel status={status!} schedule={schedule} online={telemetryFresh} />

                    <DashboardCharts deviceId={activeDeviceId} status={liveStatus} />
                    <EnhancedStatusCards status={status!} />

                    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
                      <div className="space-y-6">
                        <PumpStateDisplay status={status!} online={telemetryFresh} />
                        <LiveCycleHistoryPanel deviceId={activeDeviceId} />
                      </div>
                      <div className="space-y-6">
                        <FaultHistoryPanel deviceId={activeDeviceId} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === "controls" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Manual Controls</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Override automatic watering and dosing only when the selected hardware node is ready.</p>
                </div>
                <ManualControlPanel
                  status={liveStatus}
                  deviceId={activeDeviceId}
                  online={backendReachable}
                  controlsAllowed={controlsAllowed}
                />
                <RelayStatesCard
                  status={liveStatus}
                  online={telemetryFresh}
                  deviceId={activeDeviceId}
                  controlsAllowed={controlsAllowed}
                />
              </div>
            )}

            {/* High-Fidelity Crops Tab */}
            {activeTab === "crops" && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                      <Sprout className="h-5 w-5 text-primary" />
                      Crops Management Console
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Track growth logs, varieties seeding, and crop yields.</p>
                  </div>
                  <Button onClick={loadCropsData} variant="outline" size="sm" className="text-xs font-semibold">
                    Refresh Records
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="p-4 flex items-center justify-between border-border/80">
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase font-bold block">Active NFT Crops</span>
                      <span className="text-2xl font-extrabold block text-foreground">
                        {nftChannels.filter((c) => c.status === "growing").length} Batches
                      </span>
                    </div>
                    <Sprout className="h-8 w-8 text-green-500 opacity-80" />
                  </Card>
                  <Card className="p-4 flex items-center justify-between border-border/80">
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase font-bold block">Total Mapped Plants</span>
                      <span className="text-2xl font-extrabold block text-foreground">
                        {nftChannels.reduce((sum, c) => sum + (c.currentCount || 0), 0)} Plants
                      </span>
                    </div>
                    <Grid className="h-8 w-8 text-primary opacity-80" />
                  </Card>
                  <Card className="p-4 flex items-center justify-between border-border/80">
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase font-bold block">Completed Harvests</span>
                      <span className="text-2xl font-extrabold block text-foreground">
                        {harvestHistory.length} Batches
                      </span>
                    </div>
                    <TrendingUp className="h-8 w-8 text-yellow-500 opacity-80" />
                  </Card>
                </div>

                {/* Active Growing Channels */}
                <Card className="p-5 border-border/80">
                  <div className="border-b pb-3 mb-4">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <Sprout className="h-4 w-4 text-emerald-500 animate-pulse" />
                      Active NFT Channels Crops
                    </h3>
                    <p className="text-[11px] text-muted-foreground">Detailed layout of currently growing hydroponic channels.</p>
                  </div>
                  
                  {loadingCrops ? (
                    <div className="text-center py-6 text-xs text-muted-foreground">Loading channels data...</div>
                  ) : nftChannels.length === 0 ? (
                    <div className="text-center py-6 text-xs text-muted-foreground">No channels found. Plant a crop in the NFT Channels tab.</div>
                  ) : (
                    <div className="space-y-4">
                      {nftChannels.map((channel) => {
                        const isGrowing = channel.status === "growing";
                        const progress = isGrowing && channel.plantedAt 
                          ? Math.min(100, Math.round(((Date.now() - new Date(channel.plantedAt).getTime()) / (30 * 24 * 60 * 60 * 1000)) * 100))
                          : 0;

                        return (
                          <div key={channel.id} className="p-4 rounded-xl border bg-muted/20 space-y-3">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                              <div>
                                <span className="font-bold text-xs text-foreground block">{channel.name}</span>
                                <span className="text-[10px] text-muted-foreground block font-mono">QR: {channel.qrCode}</span>
                              </div>
                              <Badge variant={isGrowing ? "default" : "secondary"} className="text-[10px]">
                                {isGrowing ? `Growing: ${channel.cropName}` : "Vacant Channel"}
                              </Badge>
                            </div>

                            {isGrowing ? (
                              <div className="space-y-2 text-xs">
                                <div className="flex justify-between text-muted-foreground text-[11px]">
                                  <span>Planted: {channel.plantedAt ? new Date(channel.plantedAt).toLocaleDateString() : "—"}</span>
                                  <span>Expected Harvest: {channel.expectedHarvestISO ? new Date(channel.expectedHarvestISO).toLocaleDateString() : "—"}</span>
                                </div>
                                <div className="flex justify-between items-center text-[11px]">
                                  <span className="font-bold text-foreground">Capacity Load: {channel.currentCount || 0} / {channel.capacity || 50} Plants</span>
                                  <span className="font-semibold text-muted-foreground">Growth cycle est: {progress}%</span>
                                </div>
                                <Progress value={progress} className="h-1.5" />
                                {channel.notes && (
                                  <div className="text-[10px] text-muted-foreground bg-background p-2 rounded border border-border/40 font-mono">
                                    Notes: {channel.notes}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-[11px] text-muted-foreground italic font-mono">
                                Channel is ready for planting. Set details in the NFT Channels remapper.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                {/* Harvest History Log */}
                <Card className="p-5 border-border/80">
                  <div className="border-b pb-3 mb-4">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <History className="h-4 w-4 text-amber-500" />
                      Completed Harvest History Database
                    </h3>
                    <p className="text-[11px] text-muted-foreground">Audit logs of completed crop batches and yields.</p>
                  </div>

                  {loadingCrops ? (
                    <div className="text-center py-6 text-xs text-muted-foreground">Loading harvest log...</div>
                  ) : harvestHistory.length === 0 ? (
                    <div className="text-center py-6 text-xs text-muted-foreground italic">No historical crops harvested yet.</div>
                  ) : (
                    <div className="space-y-3 font-mono text-xs">
                      {harvestHistory.map((item) => {
                        const ageDays = item.plantedAt 
                          ? Math.max(1, Math.round((new Date(item.harvestedAt).getTime() - new Date(item.plantedAt).getTime()) / (24 * 60 * 60 * 1000)))
                          : null;
                        
                        return (
                          <div key={item.id} className="p-3.5 rounded-lg border bg-muted/30 flex flex-col sm:flex-row justify-between gap-3">
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-foreground text-xs">{item.cropName}</span>
                                <Badge variant="outline" className="text-[9px] font-bold bg-green-500/5 text-green-600 border-green-500/20">
                                  Yield: {item.currentCount || 0} Plants
                                </Badge>
                              </div>
                              <span className="text-[10px] text-muted-foreground block">Origin: {item.channelName} (Cap {item.capacity || 50})</span>
                              {item.notes && <p className="text-[10px] text-slate-500 italic mt-1 bg-background p-1.5 rounded">Notes: {item.notes}</p>}
                            </div>
                            <div className="text-left sm:text-right text-[10px] space-y-1 self-start sm:self-center">
                              <div className="text-foreground">Harvested: {new Date(item.harvestedAt).toLocaleDateString()}</div>
                              {ageDays && <div className="text-muted-foreground font-semibold">Total Age: {ageDays} days</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>
            )}

            {/* NFT channels */}
            {activeTab === "nft" && <NftChannelsTab />}

            {/* High-Fidelity Nursery Trays */}
            {activeTab === "nursery" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                    <Grid className="h-5 w-5 text-primary" />
                    Germination & Nursery Console
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Control seedling trays, propagation heat, and germination timers.</p>
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Your trays</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Add a tray, record what was planted, and update germination as seedlings grow.</p>
                  </div>
                  <Button onClick={addNurseryTray} className="w-full sm:w-auto">
                    <Plus className="mr-2 h-4 w-4" /> Add tray
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {nurseryTrays.map((tray) => {
                    const germination = tray.plugs > 0 ? Math.min(100, Math.round((tray.germinated / tray.plugs) * 100)) : 0;
                    return (
                      <Card key={tray.id} className="min-w-0 space-y-4 border-border/80 p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <Input aria-label="Tray name" value={tray.name} onChange={(e) => updateNurseryTray(tray.id, { name: e.target.value })} className="h-8 text-sm font-bold" />
                            <p className="mt-1 text-[11px] text-muted-foreground">{tray.crop || "No crop assigned yet"}</p>
                          </div>
                          <Button variant="ghost" size="icon" title="Remove tray" onClick={() => setNurseryTrays((trays) => trays.filter((item) => item.id !== tray.id))}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`${tray.id}-crop`} className="text-xs">Crop or variety</Label>
                            <Input id={`${tray.id}-crop`} placeholder="e.g. Romaine lettuce" value={tray.crop} onChange={(e) => updateNurseryTray(tray.id, { crop: e.target.value, status: e.target.value ? "growing" : "empty" })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`${tray.id}-date`} className="text-xs">Planted on</Label>
                            <Input id={`${tray.id}-date`} type="date" value={tray.plantedOn} onChange={(e) => updateNurseryTray(tray.id, { plantedOn: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`${tray.id}-plugs`} className="text-xs">Total plugs</Label>
                            <Input id={`${tray.id}-plugs`} type="number" min={1} value={tray.plugs} onChange={(e) => updateNurseryTray(tray.id, { plugs: Math.max(1, Number(e.target.value)) })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`${tray.id}-germinated`} className="text-xs">Germinated plugs</Label>
                            <Input id={`${tray.id}-germinated`} type="number" min={0} max={tray.plugs} value={tray.germinated} onChange={(e) => updateNurseryTray(tray.id, { germinated: Math.min(tray.plugs, Math.max(0, Number(e.target.value))), status: Number(e.target.value) >= tray.plugs ? "ready" : "growing" })} />
                          </div>
                        </div>

                        <div className="space-y-2 border-t border-border/60 pt-3">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-semibold">Germination progress</span>
                            <span className="font-bold text-primary">{germination}%</span>
                          </div>
                          <Progress value={germination} className="h-2" />
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span>{tray.germinated} of {tray.plugs} plugs ready</span>
                            <Select value={tray.status} onValueChange={(value: NurseryTray["status"]) => updateNurseryTray(tray.id, { status: value })}>
                              <SelectTrigger className="h-7 w-28 text-[11px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="empty">Empty</SelectItem>
                                <SelectItem value="growing">Growing</SelectItem>
                                <SelectItem value="ready">Ready</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* High-Fidelity Reservoir Water */}
            {activeTab === "water" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                    <Droplet className="h-5 w-5 text-primary" />
                    Reservoir Water & Quality Metrics
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Water level monitoring, tank diagnostics, and inflow audit logs.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Tank diagram */}
                  <Card className="p-5 border-border/80 md:col-span-2 flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">Main Reservoir Visualization</span>
                      <div className="flex items-center gap-6 mt-6">
                        {/* Visual level glass */}
                        <div className="w-24 h-48 bg-muted rounded-2xl border-2 border-border relative overflow-hidden shrink-0 flex items-end">
                          <div className="w-full bg-blue-500/80 animate-pulse transition-all" style={{ height: `${status?.waterLevelPercent ?? 0}%` }} />
                          <div className="absolute inset-0 flex items-center justify-center font-bold font-mono text-sm text-foreground">
                            {Math.round(status?.waterLevelPercent ?? 0)}%
                          </div>
                        </div>
                        <div className="space-y-3 text-xs flex-1">
                          <div className="flex justify-between border-b pb-1.5">
                            <span className="text-muted-foreground">Total Capacity:</span>
                            <span className="font-bold">{tankCapacity} Liters</span>
                          </div>
                          <div className="flex justify-between border-b pb-1.5">
                            <span className="text-muted-foreground">Current Volume:</span>
                            <span className="font-bold">{Math.round(status?.waterVolumeLiters ?? 0)} Liters (Calibrated)</span>
                          </div>
                          <div className="flex justify-between border-b pb-1.5">
                            <span className="text-muted-foreground">Ultrasonic Distance:</span>
                            <span className="font-bold">{status?.waterDistanceCm != null ? `${status.waterDistanceCm.toFixed(1)} cm` : "No reading"}</span>
                          </div>
                          <div className="flex justify-between border-b pb-1.5">
                            <span className="text-muted-foreground">Inflow Source:</span>
                            <span className="font-bold text-emerald-500">Filtered RO Well</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Refill Status:</span>
                            <span className="font-semibold text-slate-500">Idle (Refill Threshold 30%)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Water parameters */}
                  <Card className="p-5 border-border/80 flex flex-col justify-between">
                    <div className="space-y-4">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">Diagnostics</span>
                      
                      <div className="space-y-3 text-xs">
                        <div className="p-2 rounded bg-muted/30 border">
                          <span className="text-[10px] text-muted-foreground block">Water Temperature:</span>
                          <span className="font-extrabold text-foreground text-sm">{status?.reservoirTempC != null ? `${status.reservoirTempC.toFixed(1)}°C` : "24.5°C"}</span>
                        </div>
                        <div className="p-2 rounded bg-muted/30 border">
                          <span className="text-[10px] text-muted-foreground block">Float Switch State:</span>
                          <span className="font-extrabold text-foreground text-sm">LEVEL {status?.waterLevel ?? "FULL"}</span>
                        </div>
                        {waterPin && (
                          <div className="p-2 rounded bg-primary/5 border border-primary/20 space-y-1">
                            <span className="text-[10px] text-muted-foreground font-bold block">Water Sensor Calibration:</span>
                            <span className="text-[11px] text-foreground font-semibold block">{waterPin.type}</span>
                            <span className="text-[10px] text-slate-500 font-mono block">
                              Range: {emptyDistance}cm (Empty) - {fullDistance}cm (Full)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* Nutrition Dosing */}
            {activeTab === "nutrition" && (
              <NutritionTab status={liveStatus} schedule={schedule} onScheduleChange={setSchedule} deviceId={activeDeviceId} controlsAllowed={controlsAllowed} />
            )}

            {/* Hardware registry tab */}
            {activeTab === "devices" && <DeviceRegistryTab />}

            {/* Watering Plan */}
            {activeTab === "plan" && <ScheduleEditor />}

            {/* Pump Stats */}
            {activeTab === "stats" && <PumpStats deviceId={activeDeviceId} />}

            {/* AI insights */}
            {activeTab === "ai" && <AIInsightsCard deviceId={activeDeviceId} />}

            {/* Visual AI Camera */}
            {activeTab === "camera" && <VisualAiCameraTab activeDeviceId={activeDeviceId} />}

            {/* Manual logs */}
            {activeTab === "readings" && <ManualReadings />}
          </main>
        </div>
      </div>
      <Toaster richColors position="top-center" />
    </ErrorBoundary>
  );
}
