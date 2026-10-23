import { ContentService } from "../../src/modules/content/content.service.js";
import type { ContentRepository } from "../../src/modules/content/content.repository.js";
import type { AuthIdentity } from "../../src/modules/auth/auth.service.js";

const superuser: AuthIdentity = {
  userId: 1,
  sessionId: "session",
  role: "superuser",
  mustChangePassword: false,
};

const manager: AuthIdentity = {
  userId: 2,
  sessionId: "session",
  role: "sector_manager",
  mustChangePassword: false,
};

describe("ContentService", () => {
  it("returns only available public content", async () => {
    const repository = {
      current: async () => ({
        slug: "lgpd",
        title: "Privacidade",
        content: "Texto aprovado",
        versionNumber: 2,
        publishedAt: new Date("2026-01-01"),
      }),
    } as unknown as ContentRepository;

    await expect(new ContentService(repository).getPublished("lgpd"))
      .resolves.toMatchObject({ versionNumber: 2 });
  });

  it("allows only a superuser to publish an immutable next version", async () => {
    let received: unknown;
    const repository = {
      publish: async (...args: unknown[]) => {
        received = args;
        return {
          slug: "lgpd",
          title: "Privacidade",
          content: "Texto",
          versionNumber: 2,
          publishedAt: new Date(),
        };
      },
    } as unknown as ContentRepository;
    const service = new ContentService(repository);

    await expect(service.publish(manager, "lgpd", "Privacidade", "Texto"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.publish(superuser, "lgpd", " Privacidade ", " Texto "))
      .resolves.toMatchObject({ versionNumber: 2 });

    expect(received).toEqual([1, "lgpd", "Privacidade", "Texto"]);
  });
});
