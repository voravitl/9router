import { NextResponse } from "next/server";
import { getTokenSaveSummary } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

function periodToRange(period) {
  const end = new Date();
  const start = new Date(end);
  const p = String(period || "7d").toLowerCase();
  if (p === "24h" || p === "1d") start.setHours(start.getHours() - 24);
  else if (p === "30d") start.setDate(start.getDate() - 30);
  else start.setDate(start.getDate() - 7); // default 7d
  return { startDate: start.toISOString(), endDate: end.toISOString(), period: p === "30d" ? "30d" : p === "24h" || p === "1d" ? "24h" : "7d" };
}

/**
 * GET /api/usage/token-save-summary?period=24h|7d|30d
 * Aggregated RTK + Headroom before/after savings for the dashboard.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const { startDate, endDate, period } = periodToRange(searchParams.get("period"));
    const summary = await getTokenSaveSummary({ startDate, endDate, limit: 2000 });
    return NextResponse.json({ ...summary, periodLabel: period });
  } catch (error) {
    console.error("[API] token-save-summary failed:", error);
    return NextResponse.json({ error: "Failed to fetch token save summary" }, { status: 500 });
  }
}
