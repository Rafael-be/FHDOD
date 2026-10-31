
import "dotenv/config";

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import argon2 from "argon2";
import postgres from "postgres";
import request from "supertest";

import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";

import { PostgresAuthRepository } from "../../src/modules/auth/auth.repository.js";
import { AuthService } from "../../src/modules/auth/auth.service.js";

import { SystemClock } from "../../src/shared/core.js";
import { testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

// -----------------------------------------------------------------------------
// Configuração do ambiente
// -----------------------------------------------------------------------------

const testUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;

const hasIsolatedDatabase = usesIsolatedDatabase(testUrl, runtimeUrl);

const integration = hasIsolatedDatabase
  ? describe
  : describe.skip;

const enableMeasurements =
  process.env.PERFORMANCE_MEASUREMENTS === "true";

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 3000,

  DATABASE_URL: "postgres://test:pass@localhost/fhdod_test",

  ALLOWED_ORIGIN: "http://localhost:5173",

  JWT_SECRET: "12345678901234567890123456789012",
  JWT_ISSUER: "fhdod-api",
  JWT_AUDIENCE: "fhdod-web",

  PERFORMANCE_MEASUREMENTS: enableMeasurements,
};

// -----------------------------------------------------------------------------
// Medição opcional de desempenho
// -----------------------------------------------------------------------------

async function measure<T>(
  stage: string,
  operation: () => Promise<T>
): Promise<T> {
  if (!enableMeasurements) {
    return operation();
  }

  const start = performance.now();

  try {
    return await operation();
  } finally {
    const durationMs = performance.now() - start;

    console.info(
      `[AUTH LIFECYCLE PERF] ${stage}: ${durationMs.toFixed(2)} ms`
    );
  }
}

// -----------------------------------------------------------------------------
// Teste de integração
// -----------------------------------------------------------------------------

integration("authentication lifecycle PostgreSQL integration", () => {
  it(
    "persists, validates, revokes and renews a temporary-password session",
    async () => {
      const sql = postgres(testUrl!, {
        max: 1,
      });

      const email =
        `auth-lifecycle-${randomUUID().slice(0, 12)}@test.invalid`;

      const changedEmail =
        `auth-lifecycle-email-${randomUUID().slice(0, 12)}@test.invalid`;

      try {
        // ---------------------------------------------------------------------
        // 1. Preparar usuário de teste
        // ---------------------------------------------------------------------

        const [role] = await measure(
          "Buscar perfil superuser",
          async () => {
            return sql<{ id: number }[]>`
              SELECT id
              FROM roles
              WHERE code = 'superuser'
            `;
          }
        );

        if (!role) {
          throw new Error(
            "Perfil superuser não encontrado no banco de testes."
          );
        }

        const passwordHash = await measure(
          "Gerar hash inicial Argon2id",
          async () => {
            return argon2.hash("temporary-password", {
              type: argon2.argon2id,
            });
          }
        );

        const [user] = await measure(
          "Criar usuário de teste",
          async () => {
            return sql<{ id: number }[]>`
              INSERT INTO users (
                role_id,
                full_name,
                email,
                password_hash,
                must_change_password,
                temporary_password_expires_at,
                created_at,
                updated_at
              )
              VALUES (
                ${role.id},
                'Authentication lifecycle',
                ${email},
                ${passwordHash},
                true,
                NOW() + INTERVAL '1 day',
                NOW(),
                NOW()
              )
              RETURNING id
            `;
          }
        );

        if (!user) {
          throw new Error(
            "Não foi possível criar o usuário de teste."
          );
        }

        // ---------------------------------------------------------------------
        // 2. Inicializar a aplicação
        // ---------------------------------------------------------------------

        const repository = new PostgresAuthRepository(sql);

        const authService = new AuthService(
          repository,
          new SystemClock(),
          config
        );

        const app = createApp(config, { authService });

        const agent = request.agent(app);

        // ---------------------------------------------------------------------
        // 3. Login com senha temporária
        // ---------------------------------------------------------------------

        await measure(
          "Login com senha temporária",
          async () => {
            await agent
              .post("/api/auth/login")
              .send({
                email,
                password: "temporary-password",
              })
              .expect(200);
          }
        );

        const csrf = await measure(
          "Obter CSRF inicial",
          async () => {
            return agent
              .get("/api/auth/csrf")
              .expect(200);
          }
        );

        const csrfToken = csrf.body.data.csrfToken;

        expect(csrfToken).toEqual(expect.any(String));

        // ---------------------------------------------------------------------
        // 4. Verificar persistência da sessão
        // ---------------------------------------------------------------------

        const [persisted] = await measure(
          "Verificar sessão e refresh token",
          async () => {
            return sql<{
              active: number;
              refreshes: number;
            }[]>`
              SELECT
                COUNT(s.id) FILTER (
                  WHERE s.revoked_at IS NULL
                )::int AS active,

                (
                  SELECT COUNT(*)::int
                  FROM auth_refresh_tokens t
                  JOIN auth_sessions rs
                    ON rs.id = t.session_id
                  WHERE rs.user_id = ${user.id}
                ) AS refreshes

              FROM auth_sessions s
              WHERE s.user_id = ${user.id}
            `;
          }
        );

        expect(persisted).toEqual({
          active: 1,
          refreshes: 1,
        });

        // ---------------------------------------------------------------------
        // 5. Alterar senha temporária
        // ---------------------------------------------------------------------

        await measure(
          "Alterar senha temporária",
          async () => {
            await agent
              .post("/api/auth/change-temporary-password")
              .set("X-CSRF-Token", csrfToken)
              .send({
                currentPassword: "temporary-password",
                newPassword: "replacement-password",
              })
              .expect(204);
          }
        );

        const [revoked] = await measure(
          "Verificar revogação após troca temporária",
          async () => {
            return sql<{ active: number }[]>`
              SELECT
                COUNT(*) FILTER (
                  WHERE revoked_at IS NULL
                )::int AS active
              FROM auth_sessions
              WHERE user_id = ${user.id}
            `;
          }
        );

        expect(revoked?.active).toBe(0);

        // ---------------------------------------------------------------------
        // 6. Login com a nova senha
        // ---------------------------------------------------------------------

        await measure(
          "Login com senha substituída",
          async () => {
            await agent
              .post("/api/auth/login")
              .send({
                email,
                password: "replacement-password",
              })
              .expect(200);
          }
        );

        const establishedCsrf = await measure(
          "Obter CSRF da sessão estabelecida",
          async () => {
            return agent
              .get("/api/auth/csrf")
              .expect(200);
          }
        );

        // ---------------------------------------------------------------------
        // 7. Alterar senha definitiva
        // ---------------------------------------------------------------------

        await measure(
          "Alterar senha definitiva",
          async () => {
            await agent
              .post("/api/auth/change-password")
              .set(
                "X-CSRF-Token",
                establishedCsrf.body.data.csrfToken
              )
              .send({
                currentPassword: "replacement-password",
                newPassword: "established-password",
              })
              .expect(204);
          }
        );

        // ---------------------------------------------------------------------
        // 8. Login com senha definitiva
        // ---------------------------------------------------------------------

        await measure(
          "Login com senha definitiva",
          async () => {
            await agent
              .post("/api/auth/login")
              .send({
                email,
                password: "established-password",
              })
              .expect(200);
          }
        );

        const emailCsrf = await measure(
          "Obter CSRF para alteração de e-mail",
          async () => {
            return agent
              .get("/api/auth/csrf")
              .expect(200);
          }
        );

        // ---------------------------------------------------------------------
        // 9. Alterar e-mail
        // ---------------------------------------------------------------------

        await measure(
          "Alterar e-mail",
          async () => {
            await agent
              .post("/api/auth/change-email")
              .set(
                "X-CSRF-Token",
                emailCsrf.body.data.csrfToken
              )
              .send({
                currentPassword: "established-password",
                email: changedEmail,
              })
              .expect(204);
          }
        );

        // ---------------------------------------------------------------------
        // 10. Login com o novo e-mail
        // ---------------------------------------------------------------------

        await measure(
          "Login com novo e-mail",
          async () => {
            await agent
              .post("/api/auth/login")
              .send({
                email: changedEmail,
                password: "established-password",
              })
              .expect(200);
          }
        );

        // ---------------------------------------------------------------------
        // 11. Renovar autenticação
        // ---------------------------------------------------------------------

        const refreshed = await measure(
          "Renovar tokens",
          async () => {
            return agent
              .post("/api/auth/refresh")
              .expect(200);
          }
        );

        expect(refreshed.body.user).toEqual(
          expect.objectContaining({
            id: user.id,
            email: changedEmail,
            mustChangePassword: false,
          })
        );

        const refreshedCsrf = await agent.get("/api/auth/csrf").expect(200);

        // ---------------------------------------------------------------------
        // 12. Encerrar sessão
        // ---------------------------------------------------------------------

        await measure(
          "Realizar logout",
          async () => {
            await agent
              .post("/api/auth/logout")
              .set(
                "X-CSRF-Token",
                refreshedCsrf.body.data.csrfToken
              )
              .expect(204);
          }
        );

        // ---------------------------------------------------------------------
        // 13. Verificar revogação final
        // ---------------------------------------------------------------------

        const [afterLogout] = await measure(
          "Verificar revogação após logout",
          async () => {
            return sql<{ active: number }[]>`
              SELECT
                COUNT(*) FILTER (
                  WHERE revoked_at IS NULL
                )::int AS active
              FROM auth_sessions
              WHERE user_id = ${user.id}
            `;
          }
        );

        expect(afterLogout?.active).toBe(0);
      } finally {
        // ---------------------------------------------------------------------
        // 14. Limpar dados criados pelo teste
        // ---------------------------------------------------------------------

        try {
          await measure(
            "Remover refresh tokens de teste",
            async () => {
              await sql`
                DELETE FROM auth_refresh_tokens
                WHERE session_id IN (
                  SELECT id
                  FROM auth_sessions
                  WHERE user_id IN (
                    SELECT id
                    FROM users
                    WHERE email IN (${email}, ${changedEmail})
                  )
                )
              `;
            }
          );

          await measure(
            "Remover sessões de teste",
            async () => {
              await sql`
                DELETE FROM auth_sessions
                WHERE user_id IN (
                  SELECT id
                  FROM users
                  WHERE email IN (${email}, ${changedEmail})
                )
              `;
            }
          );

          await measure(
            "Remover usuários de teste",
            async () => {
              await sql`
                DELETE FROM users
                WHERE email IN (${email}, ${changedEmail})
              `;
            }
          );
        } finally {
          await measure(
            "Encerrar conexão PostgreSQL",
            async () => {
              await sql.end({
                timeout: 5,
              });
            }
          );
        }
      }
    },
    30_000
  );
});
