/**
 * Structured logging module for consistent error/info tracking
 * Logs to console with timestamps and severity levels
 */

export enum LogLevel {
  ERROR = "ERROR",
  WARN = "WARN",
  INFO = "INFO",
  DEBUG = "DEBUG",
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  stack?: string;
}

// In-memory log buffer (keep last 100 entries for debugging)
const logBuffer: LogEntry[] = [];
const MAX_LOG_BUFFER = 100;

function formatTimestamp(): string {
  return new Date().toISOString();
}

function addToBuffer(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }
}

export function log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    message,
    context,
    stack: error?.stack,
  };

  addToBuffer(entry);

  // Format console output
  const consoleStyle =
    level === LogLevel.ERROR
      ? "color: red; font-weight: bold;"
      : level === LogLevel.WARN
        ? "color: orange; font-weight: bold;"
        : "color: blue;";

  const logMessage = `[${entry.timestamp}] [${level}] ${message}`;

  if (typeof console !== "undefined") {
    if (level === LogLevel.ERROR) {
      console.error(`%c${logMessage}`, consoleStyle, context ?? "");
      if (error) console.error(error);
    } else if (level === LogLevel.WARN) {
      console.warn(`%c${logMessage}`, consoleStyle, context ?? "");
    } else {
      console.log(`%c${logMessage}`, consoleStyle, context ?? "");
    }
  }
}

export function error(message: string, err?: Error, context?: Record<string, unknown>): void {
  log(LogLevel.ERROR, message, context, err);
}

export function warn(message: string, context?: Record<string, unknown>): void {
  log(LogLevel.WARN, message, context);
}

export function info(message: string, context?: Record<string, unknown>): void {
  log(LogLevel.INFO, message, context);
}

export function debug(message: string, context?: Record<string, unknown>): void {
  log(LogLevel.DEBUG, message, context);
}

/**
 * Get recent logs for debugging/monitoring
 */
export function getRecentLogs(count: number = 50): LogEntry[] {
  return logBuffer.slice(Math.max(0, logBuffer.length - count));
}

/**
 * Export logs as JSON for debugging
 */
export function exportLogs(): string {
  return JSON.stringify(logBuffer, null, 2);
}

/**
 * Clear log buffer
 */
export function clearLogs(): void {
  logBuffer.length = 0;
}
