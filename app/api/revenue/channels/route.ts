import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { addChannel, listChannels, setChannelActive } from "@/lib/revenue-goals";

// GET  /api/revenue/channels?all=1   — the tree's raw rows
// POST /api/revenue/channels         — add at any level (CEO/SUPERADMIN)
// PATCH /api/revenue/channels        — { id, active } deactivate/reopen
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const all = new URL(req.url).searchParams.get("all") === "1";
    return NextResponse.json({ channels: await listChannels(all) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      bu: string; category: string; sub_category: string; channel: string;
    };
    return NextResponse.json({ channel: await addChannel(body, user) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { id: string; active: boolean };
    if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await setChannelActive(body.id, !!body.active, user);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
