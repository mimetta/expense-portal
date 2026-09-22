import { NextResponse } from "next/server";

// STAGE 2c: PATCH and DELETE retired — see app/api/roles/route.ts. Both wrote
// the new tables with no audit row. Settings > Users & access replaces them.
const GONE = NextResponse.json(
  {
    error:
      "User management has moved to Settings > Users & access. This endpoint no longer " +
      "writes, because it could not record who changed what.",
  },
  { status: 410 },
);

export async function PATCH() { return GONE; }
export async function DELETE() { return GONE; }
