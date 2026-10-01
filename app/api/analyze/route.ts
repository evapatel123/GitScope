import { NextRequest, NextResponse } from "next/server";
import { analyzeGithubUser } from "@/lib/github";

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
    const data = await analyzeGithubUser(raw);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=300" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze profile.";
    const status = message.includes("not found") ? 404 : message.includes("rate limit") ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
