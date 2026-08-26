import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

export function CameraQrScanner({
  onScanSuccess,
  onScanError,
  onClose,
}: {
  onScanSuccess: (decodedText: string) => void;
  onScanError?: (errorMessage: string) => void;
  onClose: () => void;
}) {
  const containerId = "camera-qr-scanner-element";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    const html5QrCode = new Html5Qrcode(containerId);
    scannerRef.current = html5QrCode;

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStartupError("Camera scanning requires HTTPS. Open the dashboard using its secure URL.");
      return () => {
        scannerRef.current = null;
      };
    }

    html5QrCode
      .start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 200, height: 200 },
        },
        (decodedText) => {
          onScanSuccess(decodedText);
        },
        (errorMessage) => {
          if (onScanError) onScanError(errorMessage);
        }
      )
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setStartupError(
          message.toLowerCase().includes("permission")
            ? "Camera permission was blocked. Allow camera access in the browser settings and try again."
            : "Unable to start the camera. Use HTTPS and allow camera access in the browser settings."
        );
      });

    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current
          .stop()
          .then(() => {
            scannerRef.current?.clear();
          })
          .catch((err) => console.error("Failed to stop scanner:", err));
      }
    };
  }, [onScanSuccess]);

  return (
    <div className="space-y-3 bg-muted/40 p-3 rounded-lg border border-border">
      <div className="flex justify-between items-center text-xs">
        <span className="font-bold text-foreground">🎥 Camera Active</span>
        <button
          type="button"
          onClick={onClose}
          className="text-red-500 hover:text-red-600 font-semibold"
        >
          Stop Camera
        </button>
      </div>
      <div
        id={containerId}
        className="overflow-hidden rounded-md border bg-black aspect-square max-w-[280px] mx-auto w-full"
      />
      {startupError ? (
        <p role="alert" className="text-[11px] text-red-600 text-center font-semibold">
          {startupError}
        </p>
      ) : null}
      <p className="text-[10px] text-muted-foreground text-center">
        Align the QR code inside the frame to scan automatically.
      </p>
    </div>
  );
}
