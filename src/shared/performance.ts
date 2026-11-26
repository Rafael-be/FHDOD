import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logPerformanceMeasurement } from "./logger.js";

const requestMetrics = new AsyncLocalStorage<{ queryCount: number; correlationId: string; startedAt: bigint }>();
export function recordDatabaseQuery(): void { const metrics=requestMetrics.getStore(); if(metrics) metrics.queryCount++; }
export function surveyEvent(event: string, operation: string, reason?: string): void {
  const metrics = requestMetrics.getStore();
  if (!metrics) return;
  process.stdout.write(JSON.stringify({ level: "info", event, correlationId: metrics.correlationId, operation,
    durationMs: Number(elapsedMs(metrics.startedAt).toFixed(2)), queryCount: metrics.queryCount, ...(reason ? { reason } : {}) }) + "\n");
}
export async function measureRequestStage<T>(stage: string, work: ()=>Promise<T>): Promise<T> {
  return measurePerformance(requestMetrics.getStore() !== undefined, "http.stage", stage, work);
}

const elapsedMs = (startedAt: bigint) => Number(process.hrtime.bigint() - startedAt) / 1_000_000;

/** Times a stage only when diagnostics are enabled; disabled measurements allocate no timers. */
export async function measurePerformance<T>(enabled: boolean, operation: string, stage: string, work: () => Promise<T>): Promise<T> {
  if (!enabled) return work();
  const startedAt = process.hrtime.bigint();
  try { return await work(); } finally {
    const durationMs = elapsedMs(startedAt);
    const metrics = requestMetrics.getStore();
    if (metrics) process.stdout.write(JSON.stringify({ level: "info", event: "performance.measurement", correlationId: metrics.correlationId,
      operation, stage, durationMs: Number(durationMs.toFixed(2)), queryCount: metrics.queryCount }) + "\n");
    else logPerformanceMeasurement(operation, stage, durationMs);
  }
}

/** Measures complete HTTP handling without serializing request data. */
export function performanceRequestLogger(enabled: boolean) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (enabled) {
      const startedAt = process.hrtime.bigint();
      const metrics={queryCount:0,correlationId:randomUUID(),startedAt};
      response.once("finish", () => {
        process.stdout.write(JSON.stringify({level:"info",event:"performance.request",correlationId:metrics.correlationId,operation:request.method+" "+request.path,status:response.statusCode,durationMs:Number(elapsedMs(startedAt).toFixed(2)),queryCount:metrics.queryCount})+"\n");
      });
      requestMetrics.run(metrics,next);
      return;
    }
    next();
  };
}

// Diagnostics retain only counters, never query text or parameters.
