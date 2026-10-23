import "dotenv/config";
import type { Server } from "node:http";
import { loadConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { PostgresAuthRepository } from "./modules/auth/auth.repository.js";
import { SystemClock } from "./shared/core.js";
import { createApp } from "./app.js";
import { AdminRepository } from "./modules/admin/admin.repository.js";
import { AdminService } from "./modules/admin/admin.service.js";
import { AuditRepository } from "./modules/audit/audit.repository.js";
import { AuditService } from "./modules/audit/audit.service.js";
import { HealthRepository } from "./modules/health/health.repository.js";
import { HealthService } from "./modules/health/health.service.js";
import { ContentRepository } from "./modules/content/content.repository.js";
import { ContentService } from "./modules/content/content.service.js";
import {
  logServerShutdownTimedOut,
  logServerStarted,
  logServerStartupFailed,
  logServerStopped,
  logServerStopping,
} from "./shared/logger.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function startServer(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config);
  const clock = new SystemClock();
  const healthService = new HealthService(new HealthRepository(database.client));

  try {
    await healthService.ready();
  } catch (error) {
    await database.close();
    logServerStartupFailed(error);
    process.exitCode = 1;
    return;
  }

  const authService = new AuthService(
    new PostgresAuthRepository(database.client),
    clock,
    config,
  );
  const app = createApp(config, {
    authService,
    adminService: new AdminService(
      new AdminRepository(database.client),
      clock,
      config.PERFORMANCE_MEASUREMENTS,
    ),
    auditService: new AuditService(new AuditRepository(database.client)),
    healthService,
    contentService: new ContentService(new ContentRepository(database.client)),
  });
  const server = app.listen(config.PORT, () => logServerStarted(config.PORT));

  let stopping = false;

  async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
    if (stopping) {
      return;
    }

    stopping = true;
    logServerStopping(signal);

    const timeout = setTimeout(() => {
      logServerShutdownTimedOut(SHUTDOWN_TIMEOUT_MS);
      server.closeAllConnections();
      process.exitCode = 1;
    }, SHUTDOWN_TIMEOUT_MS);
    timeout.unref();

    try {
      await closeServer(server);
      await database.close();
      logServerStopped();
    } catch (error) {
      logServerStartupFailed(error);
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

void startServer();
