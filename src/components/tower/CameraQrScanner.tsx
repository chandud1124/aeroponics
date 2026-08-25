import React, { useEffect, useRef } from "react";
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

  useEffect(() => {
    const html5QrCode = new Html5Qrcode(containerId);
    scannerRef.current = html5QrCode;

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
        console.error("Failed to start QR scanner:", err);
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
      <p className="text-[10px] text-muted-foreground text-center">
        Align the QR code inside the frame to scan automatically.
      </p>
    </div>
  );
}
