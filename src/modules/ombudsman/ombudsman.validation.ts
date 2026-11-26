import { z } from "zod";

/** Accepts common Brazilian formatting, but never strips arbitrary characters. */
export const optionalBrazilianPhone = z.union([z.string(), z.null()]).optional().transform((value, context) => {
  if (value === undefined || value === null || value.trim() === "") return undefined;
  if (!/^[\d\s()+.-]+$/.test(value)) {
    context.addIssue({ code: "custom", message: "Telefone contém caracteres inválidos." });
    return z.NEVER;
  }
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]{2}(?:9\d{8}|[2-9]\d{7})$/.test(digits)) {
    context.addIssue({ code: "custom", message: "Informe telefone brasileiro com DDD." });
    return z.NEVER;
  }
  return digits;
});
