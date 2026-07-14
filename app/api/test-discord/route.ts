import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";
import { postToWebhook } from "@/lib/discord";

// SUPERADMIN-only diagnostic endpoint for investigating why Discord
// notifications aren't sending — posts directly to DISCORD_WEBHOOK_GA (the
// General Administrative channel), bypassing the request-submission flow
// entirely so webhook config can be verified in isolation from
// department-name matching, request data, etc.
export async function GET() {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user)) throw new ForbiddenError();

    const envName = "DISCORD_WEBHOOK_GA";
    const webhookUrl = process.env[envName];
    const availableDiscordEnvVars = Object.keys(process.env).filter((k) => k.includes("DISCORD"));
    console.log("[test-discord] Available Discord env vars:", availableDiscordEnvVars);

    if (!webhookUrl) {
      return NextResponse.json({
        success: false,
        webhookFound: false,
        error: `${envName} is not set in this environment`,
        availableDiscordEnvVars,
      });
    }

    const ok = await postToWebhook(
      webhookUrl,
      `🔧 Test message from /api/test-discord, triggered by ${user.email} at ${new Date().toISOString()}`,
    );

    return NextResponse.json({
      success: ok,
      webhookFound: true,
      error: ok ? null : "Post to webhook did not succeed — check server logs for the response status/body",
      availableDiscordEnvVars,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
