import { Component, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * Error Boundary component to catch React errors and prevent crash
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("Error caught by boundary:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <Card className="p-6 border-red-200 bg-red-50">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
              <div>
                <div className="font-semibold text-red-900">Something went wrong</div>
                <div className="text-sm text-red-800 mt-1">
                  {this.state.error?.message || "An unexpected error occurred"}
                </div>
                {process.env.NODE_ENV === "development" && (
                  <div className="mt-2 bg-white rounded p-2 text-xs font-mono text-red-900 overflow-auto max-h-32">
                    {this.state.error?.stack}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )
      );
    }

    return this.props.children;
  }
}

/**
 * Hook to check recent errors from logger (for monitoring dashboard)
 */
export function useRecentErrors() {
  const { getRecentLogs } = require("./logger");
  const logs = getRecentLogs(20);
  return logs.filter((log: any) => log.level === "ERROR");
}
