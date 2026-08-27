import { useState, useEffect, useRef } from "react";
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
  Upload,
  Trash2,
  Sun,
  Moon
} from "lucide-react";
import { API_BASE_URL, withDeviceHeaders } from "@/lib/tower-storage";
import type { CameraSnapshot } from "@/lib/tower-shared";

export function VisualAiCameraTab({ activeDeviceId }: { activeDeviceId?: string | null }) {
  // Image Upload states
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [timeOfDay, setTimeOfDay] = useState<"morning" | "evening">("morning");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Snapshot states
  const [snapshots, setSnapshots] = useState<CameraSnapshot[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [activeSnapshot, setActiveSnapshot] = useState<CameraSnapshot | null>(null);

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
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (PNG, JPG, or WEBP).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleRunInspection = async () => {
    if (!uploadedImage) {
      toast.error("Please upload or capture a crop picture before starting the AI inspection.");
      return;
    }
    setInspecting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/camera/inspect`, withDeviceHeaders({
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ image: uploadedImage, timeOfDay })
      }, activeDeviceId));
      
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Inspection failed.");
      }
      
      const data = await res.json();
      toast.success("Crop canopy analysis completed successfully!");
      setSnapshots(prev => [data, ...prev]);
      setActiveSnapshot(data);
      setUploadedImage(null); // Reset preview
    } catch (err: any) {
      toast.error(err.message || "AI inspection failed");
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
            Visual AI Canopy Inspector
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Upload morning/evening crop pictures to track growth and analyze leaf health using Google Gemini Vision.</p>
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Camera simulation & Diagnostics */}
        <div className="lg:col-span-2 space-y-4">
          
          {/* Picture upload / Preview card */}
          <Card className="overflow-hidden border-border/80 p-5 space-y-4">
            <div className="border-b pb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Upload className="h-4 w-4 text-primary" />
                Upload Daily Canopy Image
              </span>
              <div className="flex items-center gap-1.5 bg-muted/40 p-1 rounded-md">
                <button
                  onClick={() => setTimeOfDay("morning")}
                  className={`text-[9px] font-bold px-2 py-1 rounded flex items-center gap-1 ${
                    timeOfDay === "morning" 
                      ? "bg-sky-500/10 text-sky-600 border border-sky-500/20" 
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sun className="h-3 w-3" />
                  Morning (AM)
                </button>
                <button
                  onClick={() => setTimeOfDay("evening")}
                  className={`text-[9px] font-bold px-2 py-1 rounded flex items-center gap-1 ${
                    timeOfDay === "evening" 
                      ? "bg-amber-500/10 text-amber-600 border border-amber-500/20" 
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Moon className="h-3 w-3" />
                  Evening (PM)
                </button>
              </div>
            </div>

            {uploadedImage ? (
              <div className="space-y-4">
                <div className="aspect-video bg-slate-950 rounded-lg overflow-hidden relative border border-border">
                  <img
                    src={uploadedImage}
                    alt="Canopy Preview"
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => setUploadedImage(null)}
                    className="absolute top-3 right-3 bg-red-600/95 hover:bg-red-700 text-white p-1.5 rounded-lg flex items-center gap-1 text-[10px] font-bold shadow-lg border border-red-500/20"
                    title="Remove Image"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                  <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm text-white text-[9px] font-bold p-1.5 rounded tracking-wide uppercase flex items-center gap-1 border border-white/10">
                    {timeOfDay === "morning" ? <Sun className="h-3 w-3 text-sky-400" /> : <Moon className="h-3 w-3 text-amber-400" />}
                    Selected for {timeOfDay} Audit
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => setUploadedImage(null)}
                    variant="outline"
                    size="sm"
                    className="text-xs h-8"
                  >
                    Change Image
                  </Button>
                  <Button
                    onClick={handleRunInspection}
                    disabled={inspecting}
                    size="sm"
                    className="bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1 px-4 h-8"
                  >
                    {inspecting ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Analyzing Canopy...
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 fill-current" />
                        Analyze Uploaded Canopy
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={triggerFileSelect}
                className={`aspect-video rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center p-6 cursor-pointer transition-colors select-none ${
                  isDragOver 
                    ? "border-primary bg-primary/5" 
                    : "border-border/80 hover:bg-muted/10 bg-slate-950/20"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="p-3 bg-primary/5 rounded-full mb-3 text-primary">
                  <Upload className="h-6 w-6" />
                </div>
                <span className="text-xs font-bold text-foreground">
                  Drag & drop crop picture here
                </span>
                <span className="text-[10px] text-muted-foreground mt-1">
                  or click to browse from files (PNG, JPG, WEBP)
                </span>
              </div>
            )}
          </Card>

          {/* Diagnosis details */}
          {activeSnapshot && (
            <Card className="p-5 border-border/80 space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-foreground block">Gemini Vision AI Analysis</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground font-mono block">
                      Captured: {new Date(activeSnapshot.timestamp).toLocaleString()}
                    </span>
                    {activeSnapshot.timeOfDay && (
                      <Badge variant="outline" className={`text-[8px] font-bold font-mono py-0 px-1.5 ${
                        activeSnapshot.timeOfDay === "morning" 
                          ? "text-sky-500 border-sky-500/20 bg-sky-500/5" 
                          : "text-amber-500 border-amber-500/20 bg-amber-500/5"
                      }`}>
                        {activeSnapshot.timeOfDay === "morning" ? "AM Audit" : "PM Audit"}
                      </Badge>
                    )}
                  </div>
                </div>
                {getHealthBadge(activeSnapshot.healthStatus)}
              </div>

              {/* Snapshot render */}
              <div className="aspect-video bg-slate-900 rounded-lg overflow-hidden relative border border-border max-h-64">
                <img
                  src={activeSnapshot.imageUrl}
                  alt="Inspection Canopy Snapshot"
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="text-xs text-foreground leading-relaxed bg-primary/5 p-4 rounded-lg border border-primary/10 font-mono whitespace-pre-line">
                {activeSnapshot.analysis}
              </div>
            </Card>
          )}
        </div>

        {/* Growth gallery timeline */}
        <div className="space-y-4">
          <Card className="p-5 border-border/80 flex flex-col justify-between h-[30rem] overflow-hidden">
            <div className="space-y-3 h-full overflow-y-auto pr-1">
              <div className="border-b pb-2 flex items-center justify-between sticky top-0 bg-card z-10">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="h-4 w-4 text-primary" />
                  Growth Timeline Log
                </span>
                <Badge variant="outline" className="text-[9px] font-bold font-mono">
                  {snapshots.length} Checked
                </Badge>
              </div>

              {loadingSnapshots ? (
                <div className="text-center py-12 text-xs text-muted-foreground italic animate-pulse">Loading timeline gallery...</div>
              ) : snapshots.length === 0 ? (
                <div className="text-center py-12 text-xs text-muted-foreground italic">No daily crop pictures uploaded yet.</div>
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
                          <span className="text-[10px] font-bold text-foreground truncate max-w-[5.5rem] flex items-center gap-1">
                            {new Date(snap.timestamp).toLocaleDateString()}
                            {snap.timeOfDay && (
                              <span className={`text-[8px] font-mono shrink-0 scale-90 ${
                                snap.timeOfDay === "morning" ? "text-sky-500" : "text-amber-500"
                              }`}>
                                {snap.timeOfDay === "morning" ? "AM" : "PM"}
                              </span>
                            )}
                          </span>
                          {getHealthBadge(snap.healthStatus)}
                        </div>
                        <p className="text-[9px] text-muted-foreground truncate font-mono">
                          {snap.analysis.split("\n")[0]}
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
              <span className="font-bold text-foreground block">Growth Audit Instruction</span>
              <p className="text-muted-foreground leading-relaxed text-[11px]">
                Upload snapshots once in the morning (AM) and once in the evening (PM). Gemini Vision AI will perform diagnostic scans, verify leaf color indexing, and cross-reference with sensor data.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
