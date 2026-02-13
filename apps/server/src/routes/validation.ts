import type { Context } from "hono"

export type JsonObject = Record<string, unknown>

export const badRequest = (c: Context, message: string) =>
  c.json({ error: message }, 400)

export const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

export const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

export async function readJsonObject(c: Context): Promise<JsonObject> {
  const body = await c.req.json().catch(() => ({}))
  if (typeof body !== "object" || body === null || Array.isArray(body)) return {}
  return body as JsonObject
}

export const parseLastEventId = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}
