import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { Sprout } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ErrorBoundary } from "@/components/error-boundary";
import { StatusCards } from "@/components/tower/StatusCards";
import { ScheduleEditor } from "@/components/tower/ScheduleEditor";
import { ManualReadings } from "@/components/tower/ManualReadings";
import { Documentation } from "@/components/tower/Documentation";
import { PumpStats } from "@/components/tower/PumpStats";
import { AIInsightsCard } from "@/components/tower/AIInsightsCard";
import AdminDevices from "@/components/tower/AdminDevices";
import { defaultSchedule, fetchSchedule, fetchStatus, type LiveStatus, type Schedule } from "@/lib/tower-storage";
import {
  FaultAlertBanner,
  FaultHistoryPanel,
  FlowPipeline,
  LiveCycleHistoryPanel,
  ManualControlPanel,
  NextCyclePanel,
  PumpStateDisplay,
  SystemHealthCard,
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
  const [mounted, setMounted] = useState(false);
  const liveStatus = mounted && status?.isOnline ? status : null;
  const isOnline = liveStatus !== null;

  useEffect(() => {
    setMounted(true);
    
    // Initial fetch
    fetchStatus().then((s) => setStatus(s));
    fetchSchedule().then((s) => s && setSchedule(s));

    const interval = setInterval(() => {
      fetchStatus().then((s) => setStatus(s));
      fetchSchedule().then((s) => s && setSchedule(s));
    }, 2000);

    return () => clearInterval(interval);
  }, []);

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
          <Tabs defaultValue="status" className="w-full">
            <TabsList className="grid w-full grid-cols-4 sm:grid-cols-7">
              <TabsTrigger value="status">Live</TabsTrigger>
              <TabsTrigger value="plan">Plan</TabsTrigger>
              <TabsTrigger value="stats">Stats</TabsTrigger>
              <TabsTrigger value="ai">AI Insights</TabsTrigger>
              <TabsTrigger value="admin">Admin</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="readings">pH/TDS/EC</TabsTrigger>
              <TabsTrigger value="docs">Build guide</TabsTrigger>
            </TabsList>

            <TabsContent value="status" className="mt-6">
              <div className="space-y-4">
                {!isOnline ? (
                  <>
                    <Card className="border-dashed p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">ESP32 offline</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            No current live readings are available. Historical cycles and faults still show below.
                          </div>
                        </div>
                        <Badge variant="destructive">OFFLINE</Badge>
                      </div>
                    </Card>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <SystemHealthCard status={null} online={false} />
                      <Card className="border-dashed p-6">
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-muted-foreground">Live telemetry hidden</div>
                          <div className="text-sm text-muted-foreground">
                            The controller will repopulate pump, light, temperature, and flow values once it reconnects.
                          </div>
                        </div>
                      </Card>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="space-y-4">
                        <LiveCycleHistoryPanel />
                      </div>

                      <div className="space-y-4">
                        <FaultHistoryPanel />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <FaultAlertBanner status={liveStatus} />

                    <div className="grid gap-4 lg:grid-cols-2">
                      <SystemHealthCard status={liveStatus} online={true} />
                      <NextCyclePanel status={liveStatus} schedule={schedule} />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="space-y-4">
                        <PumpStateDisplay status={liveStatus} />
                        <FlowPipeline status={liveStatus} />
                        <LiveCycleHistoryPanel />
                      </div>

                      <div className="space-y-4">
                        <StatusCards status={liveStatus} />
                        <ManualControlPanel />
                        <FaultHistoryPanel />
                      </div>
                    </div>
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

            <TabsContent value="stats" className="mt-6">
              <PumpStats />
            </TabsContent>

            <TabsContent value="ai" className="mt-6">
              <AIInsightsCard />
            </TabsContent>

            <TabsContent value="admin" className="mt-6">
              <AdminDevices />
            </TabsContent>

            <TabsContent value="history" className="mt-6">
              <HistoryAnalyticsTab />
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
