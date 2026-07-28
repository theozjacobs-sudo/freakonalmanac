import { NextResponse } from "next/server";
import { ConfigError } from "./supabase";

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** Uniform error mapping for API routes. */
export function handleRouteError(err: unknown) {
  if (err instanceof ConfigError) {
    return jsonError(503, "not_configured");
  }
  const message = err instanceof Error ? err.message : "unknown error";
  console.error("[api]", message);
  return jsonError(500, message);
}
