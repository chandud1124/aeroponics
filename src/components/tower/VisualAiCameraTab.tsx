import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { 
  Camera, 
  Settings, 
  Eye, 
  EyeOff, 
  RefreshCw, 
  Play, 
  AlertTriangle, 
  CheckCircle, 
  Info, 
  Calendar, 
  Clock 
} from "lucide-react";
import { withDeviceHeaders } from "@/lib/tower-storage";
import type { CameraSettings, CameraSnapshot } from "@/lib/tower-shared";

export function VisualAiCameraTab({ activeDeviceId }: { activeDeviceId?: string | null }) {
  // Settings states
  const [showSettings, setShowSettings] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [rtspUrl, setRtspUrl] = useState("");
  const [ezvizKey, setEzvizKey] = useState("");
  const [ezvizSecret, setEzvizSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [autoCapture, setAutoCapture] = useState(false);
  const [cameraConnected, setCameraConnected] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Snapshot states
  const [snapshots, setSnapshots] = useState<CameraSnapshot[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [activeSnapshot, setActiveSnapshot] = useState<CameraSnapshot | null>(null);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/camera/settings", {
        headers: { "x-admin-passkey": passcode || "0990" }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setRtspUrl(data.settings.rtspUrl || "");
          setEzvizKey(data.settings.ezvizAppKey || "");
          setEzvizSecret(data.settings.ezvizAppSecret || "");
          setAutoCapture(Boolean(data.settings.autoCapture));
          setCameraConnected(Boolean(data.settings.rtspUrl || data.settings.ezvizAppKey));
        }
      }
    } catch (e) {
      // Ignore initial auth error
    }
  };

  const fetchSnapshots = async () => {
    setLoadingSnapshots(true);
    try {
      const res = await fetch("/api/camera/snapshots");
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data.snapshots || []);
        if (data.snapshots && data.snapshots.length > 0) {
          setActiveSnapshot(data.snapshots[0]);
        }
      }
    } catch (err) {
      toast.error("Failed to load growth snapshots");
    } finally {
      setLoadingSnapshots(false);
    }
  };

  useEffect(() => {
    fetchSnapshots();
    fetchSettings();
  }, []);

  useEffect(() => {
    if (showSettings) {
      fetchSettings();
    }
  }, [showSettings, passcode]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/camera/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-passkey": passcode || "0990"
        },
        body: JSON.stringify({
          rtspUrl,
          ezvizAppKey: ezvizKey,
          ezvizAppSecret: ezvizSecret,
          autoCapture,
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Unauthorized passcode");
      }
      toast.success("EZVIZ Camera configurations saved successfully!");
      setCameraConnected(Boolean(rtspUrl.trim() || ezvizKey.trim()));
      setShowSettings(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRunInspection = async () => {
    if (!cameraConnected) {
      setShowSettings(true);
      toast.error("Connect the EZVIZ camera before starting an inspection.");
      return;
    }
    setInspecting(true);
    try {
      const res = await fetch("/api/camera/inspect", withDeviceHeaders({
        method: "POST",
        headers: {
          "x-admin-passkey": passcode || "0990"
        }
      }, activeDeviceId));
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Unauthorized passcode. Confirm passcode in settings panel.");
      }
      const data = await res.json();
      toast.success("Visual AI scan completed successfully!");
      setSnapshots(prev => [data, ...prev]);
      setActiveSnapshot(data);
    } catch (err: any) {
      toast.error(err.message || "Visual AI inspection failed");
    } finally {
      setInspecting(false);
    }
  };

  const getHealthBadge = (status: "healthy" | "warning" | "alert") => {
    if (status === "healthy") {
      return (
        <Badge variant="default" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-bold uppercase tracking-wider text-[9px] flex items-center gap-1">
          <CheckCircle className="h-3 w-3" />
          Optimal
        </Badge>
      );
    }
    if (status === "warning") {
      return (
        <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20 font-bold uppercase tracking-wider text-[9px] flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Warning
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="bg-red-500/10 text-red-600 border-red-500/20 font-bold uppercase tracking-wider text-[9px] flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Alert
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Title block */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            EZVIZ Visual AI Inspector Console
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Capture daily crop timeline feeds and scan leaf health using Multimodal AI.</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowSettings(!showSettings)}
            variant="outline"
            size="sm"
            className="flex items-center gap-1 text-xs"
          >
            <Settings className="h-4 w-4" />
            {cameraConnected ? "Camera Settings" : "Connect Camera"}
          </Button>
          <Button
            onClick={handleRunInspection}
            disabled={inspecting || !cameraConnected}
            size="sm"
            className="bg-slate-800 text-white hover:bg-slate-700 font-bold text-xs flex items-center gap-1 px-4"
          >
            {inspecting ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Scanning Canopy...
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                {cameraConnected ? "Capture & Inspect Health" : "Connect Camera First"}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Settings Form panel */}
      {showSettings && (
        <Card className="p-5 border-border/80 bg-muted/20 space-y-4">
          <div className="border-b pb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-foreground block">EZVIZ Integration Settings</span>
            <Badge variant={cameraConnected ? "default" : "outline"} className="text-[10px] font-mono">
              {cameraConnected ? "Source configured" : "Not connected"}
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5">
              <Label htmlFor="cam-passcode" className="font-bold">Admin Passcode</Label>
              <Input
                id="cam-passcode"
                type="password"
                placeholder="Passcode (default 0990)"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cam-rtsp" className="font-bold">RTSP / WebRTC Stream URL</Label>
              <Input
                id="cam-rtsp"
                placeholder="rtsp://admin:verification_code@192.168.1.100:554/h264/ch1/main"
                value={rtspUrl}
                onChange={(e) => setRtspUrl(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cam-key" className="font-bold">EZVIZ App Key (Optional)</Label>
              <Input
                id="cam-key"
                placeholder="e.g. 70fa82bc..."
                value={ezvizKey}
                onChange={(e) => setEzvizKey(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cam-secret" className="font-bold">EZVIZ App Secret / Verification Code</Label>
              <div className="relative">
                <Input
                  id="cam-secret"
                  type={showSecret ? "text" : "password"}
                  placeholder="Verification code under device body"
                  value={ezvizSecret}
                  onChange={(e) => setEzvizSecret(e.target.value)}
                  className="h-8 text-xs font-mono pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-800"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs pt-1">
            <input
              type="checkbox"
              id="auto-cap"
              checked={autoCapture}
              onChange={(e) => setAutoCapture(e.target.checked)}
              className="rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5"
            />
            <Label htmlFor="auto-cap" className="font-semibold text-muted-foreground select-none cursor-pointer">
              Enable automated daily snapshot checks (runs every day at 12:00 PM)
            </Label>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button onClick={() => setShowSettings(false)} size="sm" variant="ghost" className="h-8 text-xs">
              Cancel
            </Button>
            <Button onClick={handleSaveSettings} disabled={savingSettings} size="sm" className="h-8 text-xs bg-slate-800 text-white font-bold px-4">
              {savingSettings ? "Connecting..." : "Save & Connect"}
            </Button>
          </div>
        </Card>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Camera simulation & Diagnostics */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="overflow-hidden border-border/80 relative">
            <div className="aspect-video bg-slate-950 flex items-center justify-center relative overflow-hidden">
              {/* Dynamic Canopy Mockup */}
              {activeSnapshot ? (
                <img 
                  src={activeSnapshot.imageUrl} 
                  alt="Crop canopy stream"
                  className="absolute inset-0 w-full h-full object-cover opacity-85"
                />
              ) : (
                <div className="text-center space-y-2 px-6">
                  <Camera className="h-10 w-10 text-slate-700 mx-auto animate-pulse" />
                  <span className="text-xs font-semibold text-slate-500 block">
                    {cameraConnected ? "No visual capture yet. Start an inspection to create the first snapshot." : "Connect an EZVIZ stream in Camera Settings to begin."}
                  </span>
                </div>
              )}

              {/* Target Scan overlays */}
              <div className="absolute inset-0 border-[3px] border-dashed border-emerald-500/10 pointer-events-none" />
              <div className="absolute top-1/4 left-1/4 w-32 h-32 border-t-2 border-l-2 border-emerald-400/50 pointer-events-none" />
              <div className="absolute top-1/4 right-1/4 w-32 h-32 border-t-2 border-r-2 border-emerald-400/50 pointer-events-none" />
              <div className="absolute bottom-1/4 left-1/4 w-32 h-32 border-b-2 border-l-2 border-emerald-400/50 pointer-events-none" />
              <div className="absolute bottom-1/4 right-1/4 w-32 h-32 border-b-2 border-r-2 border-emerald-400/50 pointer-events-none" />

              {/* Live Overlay tag */}
                <div className={`absolute top-3 left-3 text-white text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider flex items-center gap-1 select-none ${cameraConnected ? "bg-emerald-600/90" : "bg-slate-700/90"}`}>
                <div className="h-1.5 w-1.5 bg-white rounded-full animate-ping" />
                  {cameraConnected ? "SOURCE CONFIGURED" : "NO CAMERA SOURCE"}
              </div>

              {rtspUrl && (
                <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm text-white text-[9px] font-mono p-1 rounded max-w-50 truncate select-none">
                  Source: {rtspUrl}
                </div>
              )}
            </div>
          </Card>

          {/* Diagnosis details */}
          {activeSnapshot && (
            <Card className="p-5 border-border/80 space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-foreground block">Visual AI Diagnoses Report</span>
                  <span className="text-[10px] text-muted-foreground font-mono block">
                    Captured on: {new Date(activeSnapshot.timestamp).toLocaleString()}
                  </span>
                </div>
                {getHealthBadge(activeSnapshot.healthStatus)}
              </div>

              <div className="text-xs text-foreground leading-relaxed bg-primary/5 p-4 rounded-lg border border-primary/10 font-mono whitespace-pre-line">
                {activeSnapshot.analysis}
              </div>
            </Card>
          )}
        </div>

        {/* Growth gallery timeline */}
        <div className="space-y-4">
          <Card className="p-5 border-border/80 flex flex-col justify-between h-97.5 overflow-hidden">
            <div className="space-y-3 h-full overflow-y-auto pr-1">
              <div className="border-b pb-2 flex items-center justify-between sticky top-0 bg-card z-10">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="h-4 w-4 text-primary" />
                  Chronological Timeline
                </span>
                <Badge variant="outline" className="text-[9px] font-bold font-mono">
                  {snapshots.length} Checked
                </Badge>
              </div>

              {loadingSnapshots ? (
                <div className="text-center py-12 text-xs text-muted-foreground italic">Loading timeline gallery...</div>
              ) : snapshots.length === 0 ? (
                <div className="text-center py-12 text-xs text-muted-foreground italic">No visual audits logged yet. Trigger a capture scan.</div>
              ) : (
                <div className="space-y-2">
                  {snapshots.map((snap) => (
                    <div 
                      key={snap.id}
                      onClick={() => setActiveSnapshot(snap)}
                      className={`p-2.5 rounded-lg border flex gap-3 items-center cursor-pointer transition-colors ${
                        activeSnapshot?.id === snap.id 
                          ? "bg-primary/5 border-primary" 
                          : "bg-muted/10 hover:bg-muted/30 border-border/60"
                      }`}
                    >
                      <div className="h-10 w-10 bg-slate-900 rounded overflow-hidden relative shrink-0">
                        <img 
                          src={snap.imageUrl} 
                          alt="Thumbnail capture" 
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-[10px] font-bold text-foreground truncate max-w-25">
                            {new Date(snap.timestamp).toLocaleDateString()}
                          </span>
                          {getHealthBadge(snap.healthStatus)}
                        </div>
                        <p className="text-[9px] text-muted-foreground truncate font-mono">
                          {snap.analysis}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card className="p-4 bg-primary/5 border border-primary/10 flex gap-3 text-xs">
            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-foreground block">Vegetative Growth Audit</span>
              <p className="text-muted-foreground leading-relaxed text-[11px]">
                The visual inspector compares leafy green surface coverage ratios day-over-day to verify growth rates. High temperatures or EC lockouts are flagged immediately as warning states.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
