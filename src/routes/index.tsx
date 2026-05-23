import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { Sprout } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorBoundary } from "@/components/error-boundary";
import { EnhancedStatusCards } from "@/components/tower/EnhancedStatusCards";
import { ScheduleEditor } from "@/components/tower/ScheduleEditor";
import { LightScheduleEditor } from "@/components/tower/LightScheduleEditor";
import { ManualReadings } from "@/components/tower/ManualReadings";
import { Documentation } from "@/components/tower/Documentation";
import { PumpStats } from "@/components/tower/PumpStats";
import { AIInsightsCard } from "@/components/tower/AIInsightsCard";
import AdminDevices from "@/components/tower/AdminDevices";
import { defaultSchedule, fetchDevices, fetchSchedule, fetchStatusEnvelope, type LiveStatus, type Schedule, type DeviceListEntry } from "@/lib/tower-storage";
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

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Tower Garden — ESP32 Hydroponic Dashboard" },
      {
        name: "description",
        content:
          "Beginner-friendly ESP32 IoT dashboard for an outdoor gravity-fed vertical aeroponic tower: schedule pump, log pH/TDS/EC, full wiring & code guide.",
      },
    ],
    links: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
  }),
});

function Index() {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [schedule, setSchedule] = useState<Schedule>(defaultSchedule);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [hasRegisteredDevice, setHasRegisteredDevice] = useState(false);
  const [devices, setDevices] = useState<DeviceListEntry[]>([]);
  const [deviceListLoaded, setDeviceListLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const liveStatus = mounted ? status : null;
  const backendReachable = mounted ? status !== null : false;
  const telemetryFresh = mounted ? Boolean(status?.isOnline) : false;
  const controlsAllowed = mounted ? telemetryFresh && hasRegisteredDevice : false;
  const activeDeviceId = selectedDeviceId.trim() || (status?.deviceId ?? null);

  useEffect(() => {
    setMounted(true);

    const storedDeviceId = window.localStorage.getItem("tower.selectedDeviceId");
    if (storedDeviceId) {
      setSelectedDeviceId(storedDeviceId);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const trimmed = selectedDeviceId.trim();
    if (trimmed) {
      window.localStorage.setItem("tower.selectedDeviceId", trimmed);
    } else {
      window.localStorage.removeItem("tower.selectedDeviceId");
    }
  }, [mounted, selectedDeviceId]);

  useEffect(() => {
    if (!mounted || deviceListLoaded) return;

    fetchDevices().then((nextDevices) => {
      setDevices(nextDevices);
      setDeviceListLoaded(true);
      if (!selectedDeviceId.trim() && nextDevices.length > 0) {
        setSelectedDeviceId(nextDevices[0].deviceId);
      }
    });
  }, [mounted, deviceListLoaded, selectedDeviceId]);

  useEffect(() => {
    if (!mounted) return;

    // Initial fetch
    fetchStatusEnvelope(selectedDeviceId.trim() || null).then((payload) => {
      setStatus(payload?.status ?? null);
      setHasRegisteredDevice(Boolean(payload?.hasRegisteredDevice));
    });
    fetchSchedule().then((s) => s && setSchedule(s));

    const interval = setInterval(() => {
      fetchStatusEnvelope(selectedDeviceId.trim() || null).then((payload) => {
        setStatus(payload?.status ?? null);
        setHasRegisteredDevice(Boolean(payload?.hasRegisteredDevice));
      });
      fetchSchedule().then((s) => s && setSchedule(s));
    }, 2000);

    return () => clearInterval(interval);
  }, [mounted, selectedDeviceId]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sprout className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Tower Garden Control</h1>
              <p className="text-xs text-muted-foreground">
                ESP32 · Outdoor vertical aeroponic tower · Karnataka edition
              </p>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6">
          <Card className="mb-6 border-border/60 bg-card/80 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <Label htmlFor="device-id-selector" className="text-sm font-medium">
                  Device selector
                </Label>
                <div className="text-xs text-muted-foreground">
                  Pick a registered device to scope live data and controls.
                </div>
              </div>
              <div className="flex w-full flex-col gap-2 sm:max-w-md sm:flex-row">
                <Select value={selectedDeviceId || "__current__"} onValueChange={(value) => setSelectedDeviceId(value === "__current__" ? "" : value)}>
                  <SelectTrigger id="device-id-selector" className="w-full">
                    <SelectValue placeholder={devices.length > 0 ? "Select a device" : "No registered devices"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__current__">Follow current device</SelectItem>
                    {devices.map((device) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.name ?? device.deviceId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedDeviceId("")}
                  disabled={!selectedDeviceId.trim()}
                >
                  Clear
                </Button>
              </div>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Active device: <span className="font-medium text-foreground">{activeDeviceId ?? "default"}</span>
            </div>
          </Card>

          <Tabs defaultValue="status" className="w-full">
            <TabsList className="grid w-full grid-cols-4 sm:grid-cols-9">
              <TabsTrigger value="status">Live</TabsTrigger>
              <TabsTrigger value="plan">Plan</TabsTrigger>
              <TabsTrigger value="light">Light</TabsTrigger>
              <TabsTrigger value="stats">Stats</TabsTrigger>
              <TabsTrigger value="ai">AI Insights</TabsTrigger>
              <TabsTrigger value="admin">Admin</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="readings">pH/TDS/EC</TabsTrigger>
              <TabsTrigger value="docs">Build guide</TabsTrigger>
            </TabsList>

            <TabsContent value="status" className="mt-6">
              <div className="space-y-4">
                {!backendReachable ? (
                  <>
                    <ManualControlPanel status={null} deviceId={activeDeviceId} online={false} controlsAllowed={false} />

                    <Card className="border-dashed p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">Backend unavailable</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            The local API could not be reached, so live control and relay status are unavailable.
                          </div>
                        </div>
                        <Badge variant="destructive">OFFLINE</Badge>
                      </div>
                    </Card>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <RelayStatesCard status={null} online={false} deviceId={activeDeviceId} controlsAllowed={false} />
                      <Card className="border-dashed p-6">
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-muted-foreground">Live telemetry hidden</div>
                          <div className="text-sm text-muted-foreground">
                            The controller will repopulate pump, light, and humidity values once the backend returns.
                          </div>
                        </div>
                      </Card>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="space-y-4">
                        <LiveCycleHistoryPanel deviceId={activeDeviceId} />
                      </div>

                      <div className="space-y-4">
                        <FaultHistoryPanel deviceId={activeDeviceId} />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {(() => {
                      const currentStatus = status as LiveStatus;
                      return (
                        <>
                    {!telemetryFresh ? (
                      <Card className="border-dashed p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">ESP32 offline</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              The controller is not reporting live telemetry right now. Manual controls stay available and the last known relay state remains visible.
                            </div>
                          </div>
                          <Badge variant="destructive">OFFLINE</Badge>
                        </div>
                      </Card>
                    ) : (
                      <FaultAlertBanner status={currentStatus} />
                    )}

                    <ManualControlPanel
                      status={currentStatus}
                      deviceId={activeDeviceId}
                      online={telemetryFresh}
                      controlsAllowed={controlsAllowed}
                    />

                    <div className="grid gap-4 xl:grid-cols-2">
                      <RelayStatesCard
                        status={currentStatus}
                        online={telemetryFresh}
                        deviceId={activeDeviceId}
                        controlsAllowed={controlsAllowed}
                      />
                      <NextCyclePanel status={currentStatus} schedule={schedule} online={telemetryFresh} />
                    </div>

                    <div className="grid gap-4 2xl:grid-cols-2">
                      <div className="space-y-4">
                        <PumpStateDisplay status={currentStatus} online={telemetryFresh} />
                        <LiveCycleHistoryPanel deviceId={activeDeviceId} />
                      </div>

                      <div className="space-y-4">
                        <EnhancedStatusCards status={currentStatus} />
                        <FaultHistoryPanel deviceId={activeDeviceId} />
                      </div>
                    </div>
                        </>
                      );
                    })()}
                  </>
                )}

                <p className="text-xs text-muted-foreground">
                  Live values are posted by your ESP32 to the local API and stream here in real time.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="plan" className="mt-6">
              <ScheduleEditor />
            </TabsContent>

            <TabsContent value="light" className="mt-6">
              <LightScheduleEditor />
            </TabsContent>

            <TabsContent value="stats" className="mt-6">
              <PumpStats deviceId={activeDeviceId} />
            </TabsContent>

            <TabsContent value="ai" className="mt-6">
              <AIInsightsCard deviceId={activeDeviceId} />
            </TabsContent>

            <TabsContent value="admin" className="mt-6">
              <AdminDevices />
            </TabsContent>

            <TabsContent value="history" className="mt-6">
              <HistoryAnalyticsTab deviceId={activeDeviceId} />
            </TabsContent>

            <TabsContent value="readings" className="mt-6">
              <ManualReadings />
            </TabsContent>

            <TabsContent value="docs" className="mt-6">
              <Documentation />
            </TabsContent>
          </Tabs>
        </main>

        <Toaster richColors position="top-center" />
      </div>
    </ErrorBoundary>
  );
}
