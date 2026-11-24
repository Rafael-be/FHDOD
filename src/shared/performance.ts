import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { logPerformanceMeasurement } from "./logger.js";

const requestMetrics = new AsyncLocalStorage<{ queryCount: number }>();
export function recordDatabaseQuery(): void { const metrics=requestMetrics.getStore(); if(metrics) metrics.queryCount++; }
export async function measureRequestStage<T>(stage: string, work: ()=>Promise<T>): Promise<T> {
  return measurePerformance(requestMetrics.getStore() !== undefined, "http.stage", stage, work);
}

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
      const metrics={queryCount:0};
      response.once("finish", () => {
        logPerformanceMeasurement(`http.${request.method.toLowerCase()} ${request.path}`, "total", elapsedMs(startedAt));
        process.stdout.write(JSON.stringify({level:"info",event:"performance.query_count",operation:request.method+" "+request.path,queryCount:metrics.queryCount})+"\n");
      });
      requestMetrics.run(metrics,next);
      return;
    }
    next();
  };
}

// Diagnostics retain only counters, never query text or parameters.
