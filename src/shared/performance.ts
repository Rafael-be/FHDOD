import type { NextFunction, Request, Response } from "express";
import { logPerformanceMeasurement } from "./logger.js";

const elapsedMs = (startedAt: bigint) => Number(process.hrtime.bigint() - startedAt) / 1_000_000;

/** Times a stage only when diagnostics are enabled; disabled measurements allocate no timers. */
export async function measurePerformance<T>(enabled: boolean, operation: string, stage: string, work: () => Promise<T>): Promise<T> {
  if (!enabled) return work();
  const startedAt = process.hrtime.bigint();
  try { return await work(); } finally { logPerformanceMeasurement(operation, stage, elapsedMs(startedAt)); }
}

/** Measures complete HTTP handling without serializing request data. */
export function performanceRequestLogger(enabled: boolean) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (enabled) {
      const startedAt = process.hrtime.bigint();
      response.once("finish", () => logPerformanceMeasurement(`http.${request.method.toLowerCase()} ${request.path}`, "total", elapsedMs(startedAt)));
    }
    next();
  };
}
