import { z } from "zod";

/** Shared login contract for HTTP validation and initial-account provisioning. */
export const loginCredentialsSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });

/** Safe, current account data that may be exposed by authentication endpoints. */
export const publicAuthUserSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(["superuser", "sector_manager"]),
  mustChangePassword: z.boolean(),
});

export const authUserResponseSchema = z.object({ user: publicAuthUserSchema });
export type PublicAuthUser = z.infer<typeof publicAuthUserSchema>;
export type AuthUserResponse = z.infer<typeof authUserResponseSchema>;

export function authUserResponse(user: PublicAuthUser): AuthUserResponse {
  return { user };
}
