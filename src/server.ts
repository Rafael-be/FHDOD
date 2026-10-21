import "dotenv/config";
import { loadConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { PostgresAuthRepository } from "./modules/auth/auth.repository.js";
import { SystemClock, NoopTransactionManager } from "./shared/core.js";
import { createApp } from "./app.js";
import { AdminRepository } from "./modules/admin/admin.repository.js";
import { AdminService } from "./modules/admin/admin.service.js";

const config = loadConfig(); const database = createDatabase(config);
const auth = new AuthService(new PostgresAuthRepository(database.client), new NoopTransactionManager(), new SystemClock(), config);
const app = createApp(config, auth, new AdminService(new AdminRepository(database.client), new SystemClock()));
const server = app.listen(config.PORT, () => console.info(`FHDOD API iniciada na porta ${config.PORT}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => void database.close()));
