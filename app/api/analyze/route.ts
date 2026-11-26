import { NextRequest, NextResponse } from "next/server";
import { analyzeCachedGithubUser, GithubEvidenceError } from "@/lib/github";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("username")?.trim().replace(/^@/, "");

  if (!raw) {
    return NextResponse.json({ error: "Enter a GitHub username." }, { status: 400 });
  }

  if (!/^[A-Za-z0-9-]{1,39}$/.test(raw) || raw.startsWith("-") || raw.endsWith("-")) {
    return NextResponse.json({ error: "That is not a valid GitHub username." }, { status: 400 });
  }

  try {
    const data = await analyzeCachedGithubUser(raw);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof GithubEvidenceError ? error.message : "GitHub evidence unavailable. No score was calculated. Please try again later.";
    const status = error instanceof GithubEvidenceError ? error.status : 502;
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (error instanceof GithubEvidenceError && error.status === 429 && error.retryAt !== undefined) {
      headers["Retry-After"] = String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000)));
    }
    return NextResponse.json({ error: message }, { status, headers });
  }
}
