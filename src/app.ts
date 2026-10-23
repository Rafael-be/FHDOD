import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import type { AppConfig } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./shared/core.js";
import { httpRequestLogger } from "./shared/logger.js";
import type { AuthService } from "./modules/auth/auth.service.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { authenticate } from "./modules/auth/auth.middleware.js";
import { openapiDocument } from "./docs/openapi.js";
import type { AdminService } from "./modules/admin/admin.service.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import type { AuditService } from "./modules/audit/audit.service.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import type { HealthService } from "./modules/health/health.service.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import type { ContentService } from "./modules/content/content.service.js";
import { contentRoutes } from "./modules/content/content.routes.js";
import { performanceRequestLogger } from "./shared/performance.js";

export interface AppDependencies {
  authService: AuthService;
  adminService?: AdminService;
  auditService?: AuditService;
  healthService?: HealthService;
  contentService?: ContentService;
}

function validateRuntimeDependencies(
  config: AppConfig,
  dependencies: AppDependencies,
): void {
  if (config.NODE_ENV === "test") {
    return;
  }

  const missing = [
    !dependencies.adminService ? "adminService" : null,
    !dependencies.auditService ? "auditService" : null,
    !dependencies.healthService ? "healthService" : null,
    !dependencies.contentService ? "contentService" : null,
  ].filter((dependency): dependency is string => dependency !== null);

  if (missing.length > 0) {
    throw new Error(`Dependências obrigatórias ausentes: ${missing.join(", ")}.`);
  }
}

/** Creates the HTTP boundary; runtime dependencies must be composed explicitly. */
export function createApp(config: AppConfig, dependencies: AppDependencies) {
  validateRuntimeDependencies(config, dependencies);

  const {
    authService,
    adminService,
    auditService,
    healthService,
    contentService,
  } = dependencies;
  const app = express();
  app.disable("x-powered-by");
  if (config.NODE_ENV !== "test") app.use(httpRequestLogger);
  app.use(helmet());
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || origin === config.ALLOWED_ORIGIN), credentials: true, methods: ["GET", "POST", "PATCH", "DELETE"] }));
  app.use(express.json({ limit: "32kb" })); app.use(cookieParser());
  app.use(performanceRequestLogger(config.PERFORMANCE_MEASUREMENTS));
  if (healthService) app.use(healthRoutes(healthService));
  else app.get("/health", (_request, response) => response.status(200).json({ data: { status: "ok" } }));
  app.use("/api/auth", authRoutes(authService, config));
  if (adminService) app.use("/api", authenticate(authService), adminRoutes(adminService, authService));
  if (auditService) app.use("/api", authenticate(authService), auditRoutes(auditService));
  if (contentService) app.use("/api", contentRoutes(contentService, authService));
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDocument, { explorer: false }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
