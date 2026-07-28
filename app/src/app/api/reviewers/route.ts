import { NextRequest, NextResponse } from "next/server";
import { getReviewerByToken, getSupabase } from "@/lib/supabase";
import { handleRouteError, jsonError } from "@/lib/api";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

/**
 * Reviewer management — admin only (reviewers.is_admin = true).
 *
 * GET  /api/reviewers?token=...          → list all reviewers with tokens
 * POST /api/reviewers { token, name }    → create a reviewer, returns the row
 *
 * Tokens are `<name-slug>-<8 hex>`, matching the seeded format.
 */

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "reviewer"
  );
}

async function requireAdmin(token: string | null) {
  const sb = getSupabase();
  const me = await getReviewerByToken(sb, token);
  if (!me) return { error: jsonError(401, "invalid_token") };
  if (!me.is_admin) return { error: jsonError(403, "admin_only") };
  return { sb, me };
}

export async function GET(req: NextRequest) {
  try {
    const gate = await requireAdmin(req.nextUrl.searchParams.get("token"));
    if ("error" in gate) return gate.error;

    const { data, error } = await gate.sb
      .from("reviewers")
      .select("id,name,token,is_admin")
      .order("id");
    if (error) throw new Error(error.message);
    return NextResponse.json({ reviewers: data ?? [] });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonError(400, "bad_json");
    const { token, name } = body as { token?: string; name?: string };

    const trimmed = (name ?? "").trim();
    if (trimmed.length < 1 || trimmed.length > 60) return jsonError(400, "bad_name");

    const gate = await requireAdmin(token ?? null);
    if ("error" in gate) return gate.error;

    const newToken = `${slugify(trimmed)}-${randomBytes(4).toString("hex")}`;
    const { data, error } = await gate.sb
      .from("reviewers")
      .insert({ name: trimmed, token: newToken, is_admin: false })
      .select("id,name,token,is_admin")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ reviewer: data });
  } catch (err) {
    return handleRouteError(err);
  }
}
