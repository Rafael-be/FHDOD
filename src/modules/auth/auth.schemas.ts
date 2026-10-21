import { z } from "zod";

/** Shared login contract for HTTP validation and initial-account provisioning. */
export const loginCredentialsSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });
