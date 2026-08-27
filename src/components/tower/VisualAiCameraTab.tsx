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
  Clock,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { API_BASE_URL, withDeviceHeaders } from "@/lib/tower-storage";
import type { CameraSettings, CameraSnapshot } from "@/lib/tower-shared";

export function VisualAiCameraTab({ activeDeviceId }: { activeDeviceId?: string | null }) {
  // Settings states
  const [showSettings, setShowSettings] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [rtspUrl, setRtspUrl] = useState("");
  const [liveStreamUrl, setLiveStreamUrl] = useState("");
  const [ezvizKey, setEzvizKey] = useState("");
  const [ezvizSecret, setEzvizSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [autoCapture, setAutoCapture] = useState(false);
  const [cameraConnected, setCameraConnected] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Discovery / Live Feed states
  const [viewMode, setViewMode] = useState<"snapshot" | "live">("snapshot");
  const [discoveredDevices, setDiscoveredDevices] = useState<any[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [scanPosition, setScanPosition] = useState("default");

  // Snapshot states
  const [snapshots, setSnapshots] = useState<CameraSnapshot[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [activeSnapshot, setActiveSnapshot] = useState<CameraSnapshot | null>(null);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/camera/settings`, {
        headers: { "x-admin-passkey": passcode || "0990" }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setRtspUrl(data.settings.rtspUrl || "");
          setLiveStreamUrl(data.settings.liveStreamUrl || "");
          setEzvizKey(data.settings.ezvizAppKey || "");
          setEzvizSecret(data.settings.ezvizAppSecret || "");
          setAutoCapture(Boolean(data.settings.autoCapture));
          setCameraConnected(Boolean(data.settings.rtspUrl || data.settings.ezvizAppKey || data.settings.liveStreamUrl));
        }
      }
    } catch (e) {
      // Ignore initial auth error
    }
  };

  const fetchDiscoveredDevices = async () => {
    setLoadingDevices(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/camera/ezviz-devices`, {
        headers: { "x-admin-passkey": passcode || "0990" }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to search EZVIZ account devices");
      }
      const data = await res.json();
      setDiscoveredDevices(data.devices || []);
      toast.success(`Successfully discovered ${data.devices?.length || 0} EZVIZ devices!`);
    } catch (err: any) {
      toast.error(err.message || "Failed to search EZVIZ Cloud devices");
    } finally {
      setLoadingDevices(false);
    }
  };

  const fetchSnapshots = async () => {
    setLoadingSnapshots(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/camera/snapshots`);
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
      const res = await fetch(`${API_BASE_URL}/api/camera/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-passkey": passcode || "0990"
        },
        body: JSON.stringify({
          rtspUrl,
          liveStreamUrl,
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
      setCameraConnected(Boolean(rtspUrl.trim() || ezvizKey.trim() || liveStreamUrl.trim()));
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
      const res = await fetch(`${API_BASE_URL}/api/camera/inspect`, withDeviceHeaders({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-passkey": passcode || "0990"
        },
        body: JSON.stringify({ scanPosition })
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

  const handlePtzAction = async (action: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/camera/ptz`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-passkey": passcode || "0990"
        },
        body: JSON.stringify({ action })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "PTZ command failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to control camera movement");
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
          {cameraConnected && (
            <select
              value={scanPosition}
              onChange={(e) => setScanPosition(e.target.value)}
              className="bg-background text-foreground border border-input rounded-md px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary select-none h-8 cursor-pointer"
            >
              <option value="default">Default Center Target</option>
              <option value="left">Left Sector Sweep</option>
              <option value="right">Right Sector Sweep</option>
              <option value="zoom">Canopy Macro Detail</option>
            </select>
          )}
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
              <Label htmlFor="cam-rtsp" className="font-bold">Backend RTSP Source URL</Label>
              <Input
                id="cam-rtsp"
                placeholder="rtsp://admin:verification_code@192.168.1.100:554/h264/ch1/main"
                value={rtspUrl}
                onChange={(e) => setRtspUrl(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cam-webrtc" className="font-bold">Browser WebRTC/MediaMTX Stream URL</Label>
              <Input
                id="cam-webrtc"
                placeholder="e.g. http://192.168.0.50:8889/outdoor"
                value={liveStreamUrl}
                onChange={(e) => setLiveStreamUrl(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5 font-mono text-[9px] text-muted-foreground pt-3 flex flex-col justify-end">
              <span>* Use RTSP for AI scanning backend.</span>
              <span>* Use WebRTC (e.g. MediaMTX URL) for live stream viewing.</span>
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

          {ezvizKey && ezvizSecret && (
            <div className="border-t border-border/60 pt-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">EZVIZ Cloud Scanner</span>
                <Button
                  onClick={fetchDiscoveredDevices}
                  disabled={loadingDevices}
                  size="xs"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-6 px-3 text-[10px] flex items-center gap-1"
                >
                  {loadingDevices ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Searching...
                    </>
                  ) : (
                    "Search Account Devices"
                  )}
                </Button>
              </div>

              {discoveredDevices.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {discoveredDevices.map((device: any) => (
                    <div key={device.deviceSerial} className="p-2 border rounded-lg bg-card text-xs flex justify-between items-center border-border/85">
                      <div>
                        <span className="font-bold block text-[11px] text-foreground">{device.deviceName}</span>
                        <span className="text-[9px] text-muted-foreground block font-mono">Serial: {device.deviceSerial} ({device.deviceModel})</span>
                        <span className={`text-[9px] font-bold ${device.status === 1 ? "text-emerald-500 animate-pulse" : "text-slate-400"}`}>
                          {device.status === 1 ? "● Online" : "○ Offline"}
                        </span>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        className="text-[9px] h-6 px-2 shrink-0 ml-2"
                        onClick={() => {
                          setRtspUrl(`rtsp://admin:${ezvizSecret || "VERIFICATION_CODE"}@CAMERA_IP_ADDRESS:554/h264/ch1/main/av_stream`);
                          toast.info(`Configured RTSP template. Change CAMERA_IP_ADDRESS to the camera's local IP address.`);
                        }}
                      >
                        Add Stream Template
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
            {/* View Mode Overlay Toggle */}
            {liveStreamUrl && (
              <div className="absolute top-3 right-3 z-10 flex bg-black/75 backdrop-blur-md rounded-lg p-0.5 border border-white/10 text-[9px] font-bold select-none">
                <button
                  onClick={() => setViewMode("snapshot")}
                  className={`px-2 py-1 rounded transition-colors ${viewMode === "snapshot" ? "bg-slate-800 text-white" : "text-white/60 hover:text-white"}`}
                >
                  SNAPSHOTS
                </button>
                <button
                  onClick={() => setViewMode("live")}
                  className={`px-2 py-1 rounded transition-colors ${viewMode === "live" ? "bg-slate-800 text-white" : "text-white/60 hover:text-white"}`}
                >
                  LIVE FEED
                </button>
              </div>
            )}

            <div className="aspect-video bg-slate-950 flex items-center justify-center relative overflow-hidden">
              {viewMode === "live" && liveStreamUrl ? (
                <iframe
                  src={liveStreamUrl.includes("?") ? liveStreamUrl : `${liveStreamUrl}?autoplay=true&muted=true`}
                  className="absolute inset-0 w-full h-full border-none"
                  allow="autoplay; fullscreen"
                />
              ) : activeSnapshot ? (
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
              {viewMode !== "live" && (
                <>
                  <div className="absolute inset-0 border-[3px] border-dashed border-emerald-500/10 pointer-events-none" />
                  <div className="absolute top-1/4 left-1/4 w-32 h-32 border-t-2 border-l-2 border-emerald-400/50 pointer-events-none" />
                  <div className="absolute top-1/4 right-1/4 w-32 h-32 border-t-2 border-r-2 border-emerald-400/50 pointer-events-none" />
                  <div className="absolute bottom-1/4 left-1/4 w-32 h-32 border-b-2 border-l-2 border-emerald-400/50 pointer-events-none" />
                  <div className="absolute bottom-1/4 right-1/4 w-32 h-32 border-b-2 border-r-2 border-emerald-400/50 pointer-events-none" />
                </>
              )}

              {/* Live Overlay tag */}
              <div className={`absolute top-3 left-3 text-white text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider flex items-center gap-1 select-none z-10 ${cameraConnected ? "bg-emerald-600/90" : "bg-slate-700/90"}`}>
                <div className="h-1.5 w-1.5 bg-white rounded-full animate-ping" />
                {viewMode === "live" ? "LIVE STREAM" : (cameraConnected ? "SOURCE CONFIGURED" : "NO CAMERA SOURCE")}
              </div>

              {viewMode === "live" && liveStreamUrl && (
                <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm text-white text-[9px] font-mono p-1 rounded max-w-50 truncate select-none z-10">
                  Stream: {liveStreamUrl}
                </div>
              )}

              {viewMode !== "live" && rtspUrl && (
                <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm text-white text-[9px] font-mono p-1 rounded max-w-50 truncate select-none z-10">
                  Source: {rtspUrl}
                </div>
              )}
            </div>
          </Card>

          {/* PTZ Controller pad */}
          {cameraConnected && (
            <Card className="p-4 border-border/80 bg-muted/10">
              <div className="flex items-center justify-between border-b pb-2 mb-3">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Settings className="h-3.5 w-3.5 text-primary" />
                  EZVIZ PTZ Local Controller
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">ONVIF Protocol Enabled</span>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-6 items-center justify-center py-2">
                {/* D-Pad controls */}
                <div className="relative w-28 h-28 bg-slate-900/60 rounded-full border border-border flex items-center justify-center shadow-inner">
                  {/* Up button */}
                  <button
                    onMouseDown={() => handlePtzAction("up")}
                    onMouseUp={() => handlePtzAction("stop")}
                    onMouseLeave={() => handlePtzAction("stop")}
                    onTouchStart={() => handlePtzAction("up")}
                    onTouchEnd={() => handlePtzAction("stop")}
                    className="absolute top-1 left-1/2 -translate-x-1/2 p-2 text-foreground hover:text-primary active:scale-95 transition-transform"
                    title="Move Up"
                  >
                    <ArrowUp className="h-5 w-5" />
                  </button>
                  {/* Left button */}
                  <button
                    onMouseDown={() => handlePtzAction("left")}
                    onMouseUp={() => handlePtzAction("stop")}
                    onMouseLeave={() => handlePtzAction("stop")}
                    onTouchStart={() => handlePtzAction("left")}
                    onTouchEnd={() => handlePtzAction("stop")}
                    className="absolute left-1 top-1/2 -translate-y-1/2 p-2 text-foreground hover:text-primary active:scale-95 transition-transform"
                    title="Move Left"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  {/* Right button */}
                  <button
                    onMouseDown={() => handlePtzAction("right")}
                    onMouseUp={() => handlePtzAction("stop")}
                    onMouseLeave={() => handlePtzAction("stop")}
                    onTouchStart={() => handlePtzAction("right")}
                    onTouchEnd={() => handlePtzAction("stop")}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-foreground hover:text-primary active:scale-95 transition-transform"
                    title="Move Right"
                  >
                    <ArrowRight className="h-5 w-5" />
                  </button>
                  {/* Down button */}
                  <button
                    onMouseDown={() => handlePtzAction("down")}
                    onMouseUp={() => handlePtzAction("stop")}
                    onMouseLeave={() => handlePtzAction("stop")}
                    onTouchStart={() => handlePtzAction("down")}
                    onTouchEnd={() => handlePtzAction("stop")}
                    className="absolute bottom-1 left-1/2 -translate-x-1/2 p-2 text-foreground hover:text-primary active:scale-95 transition-transform"
                    title="Move Down"
                  >
                    <ArrowDown className="h-5 w-5" />
                  </button>
                  {/* Center Stop circle */}
                  <button
                    onClick={() => handlePtzAction("stop")}
                    className="w-10 h-10 bg-slate-950 rounded-full border border-border flex items-center justify-center hover:bg-slate-800 text-[9px] font-bold text-muted-foreground select-none"
                  >
                    STOP
                  </button>
                </div>

                {/* Zoom controls */}
                <div className="flex flex-row sm:flex-col gap-2 w-full sm:w-auto">
                  <Button
                    onMouseDown={() => handlePtzAction("zoom_in")}
                    onMouseUp={() => handlePtzAction("stop")}
                    onMouseLeave={() => handlePtzAction("stop")}
                    onTouchStart={() => handlePtzAction("zoom_in")}
                    onTouchEnd={() => handlePtzAction("stop")}
                    size="sm"
                    variant="outline"
                    className="flex-1 sm:flex-initial text-xs flex items-center justify-center gap-1.5 h-8 font-bold"
                  >
                    <ZoomIn className="h-4 w-4" />
                    Zoom In
                  </Button>
                  <Button
                    onMouseDown={() => handlePtzAction("zoom_out")}
                    onMouseUp={() => handlePtzAction("stop")}
                    onMouseLeave={() => handlePtzAction("stop")}
                    onTouchStart={() => handlePtzAction("zoom_out")}
                    onTouchEnd={() => handlePtzAction("stop")}
                    size="sm"
                    variant="outline"
                    className="flex-1 sm:flex-initial text-xs flex items-center justify-center gap-1.5 h-8 font-bold"
                  >
                    <ZoomOut className="h-4 w-4" />
                    Zoom Out
                  </Button>
                </div>
              </div>
            </Card>
          )}

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
