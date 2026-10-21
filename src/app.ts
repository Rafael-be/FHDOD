import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import type { AppConfig } from "./config/env.js";
import { errorHandler } from "./shared/core.js";
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

/** Creates the HTTP boundary; domain dependencies are composed explicitly in server.ts. */
export function createApp(config: AppConfig, authService: AuthService, adminService?: AdminService, auditService?: AuditService, healthService?: HealthService) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.ALLOWED_ORIGIN, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE"] }));
  app.use(express.json({ limit: "32kb" })); app.use(cookieParser());
  if (healthService) app.use(healthRoutes(healthService));
  else app.get("/health", (_request, response) => response.status(200).json({ data: { status: "ok" } }));
  app.use("/api/auth", authenticate(authService), authRoutes(authService, config));
  if (adminService) app.use("/api", authenticate(authService), adminRoutes(adminService, authService));
  if (auditService) app.use("/api", authenticate(authService), auditRoutes(auditService));
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDocument, { explorer: false }));
  app.use(errorHandler); return app;
}
