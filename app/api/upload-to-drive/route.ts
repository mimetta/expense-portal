import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { handleApiError } from "@/lib/api-helpers";
import { createRequestFolder, uploadFileToDrive, DriveAuthError } from "@/lib/google-drive";

// Uploads one /submit (or edit-form) attachment straight into the
// requester's own Google Drive, under
// Expense Portal / <budgetPeriod> / <requestId> /, using the *signed-in
// user's* Google OAuth access token — not a service account. See
// CLAUDE.md "File Storage" for why this app otherwise stores attachments
// as base64 in `requests.files_json`; this is a deliberate, later
// exception for real Drive-backed storage.
//
// Known, real limitations of this approach (flagging rather than hiding,
// per this project's convention — see CLAUDE.md's many "not yet
// provisioned" notes):
//
// 1. **OAuth scope**: `session.provider_token` only carries Drive
//    permissions if the Google sign-in request actually asked for a Drive
//    scope. app/login/page.tsx now requests
//    `https://www.googleapis.com/auth/drive.file` — but every user who
//    already has a live session from *before* that change will have a
//    provider_token with no Drive access at all, and will hit the
//    `reauth_required` path below on first upload until they sign out and
//    back in once.
// 2. **Token lifetime**: Google access tokens expire after ~1 hour, and
//    Supabase does not refresh `provider_token` the way it refreshes its
//    own session — a tab left open across that window will start failing
//    uploads with `reauth_required` even mid-session, not just on return
//    visits. There's no infrastructure in this app to silently refresh a
//    Google access token (that needs a stored `provider_refresh_token`
//    and a manual call to Google's token endpoint), so the only recovery
//    path is "sign out, sign in again."
// 3. **`drive.file` scope + a pre-existing shared root folder**: the
//    `drive.file` scope only grants access to files/folders the app
//    itself creates, or that the user has explicitly opened via a Google
//    Picker — it does *not* automatically grant access to the existing
//    root folder ID below just because that folder is "shared with the
//    user" in the ordinary Drive-sharing sense. In practice this means
//    the very first `getOrCreateFolder` call against DRIVE_ROOT_FOLDER_ID
//    will fail for a user whose account doesn't already have some other
//    access path to it, unless the broader (sensitive, Google-verification
//    -gated) `drive` scope is used instead. This is a real product
//    decision this repo can't make unilaterally — flagged for the user
//    rather than silently swapping to the broader scope.
// Best-effort diagnostic only — calls Google's own tokeninfo endpoint to
// see what scopes are actually attached to this access token, since
// Supabase's Session type has no `scope` field of its own for the
// provider token (only `provider_token`/`provider_refresh_token`). Never
// throws; a failure here just means one fewer log line, not a failed
// upload.
async function logTokenScopes(accessToken: string): Promise<void> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log("[upload-to-drive] tokeninfo check failed:", res.status, body);
      return;
    }
    const scopes = typeof body.scope === "string" ? body.scope.split(" ") : [];
    console.log(
      "[upload-to-drive] token scopes:",
      scopes,
      "has drive.file:",
      scopes.includes("https://www.googleapis.com/auth/drive.file"),
      "expires_in:",
      body.expires_in,
    );
  } catch (err) {
    console.log("[upload-to-drive] tokeninfo check threw:", err);
  }
}

export async function POST(request: Request) {
  try {
    await requireUser();

    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.provider_token;
    console.log("[upload-to-drive] provider_token present:", !!accessToken);
    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          error: "reauth_required",
          detail: "No provider_token on the current session — sign out and back in to grant Drive access.",
        },
        { status: 401 },
      );
    }
    await logTokenScopes(accessToken);

    const formData = await request.formData();
    const file = formData.get("file");
    const fileName = (formData.get("fileName") as string | null) || (file instanceof File ? file.name : "");
    const requestId = formData.get("requestId") as string | null;
    const budgetPeriod = formData.get("budgetPeriod") as string | null;

    if (!(file instanceof File) || !fileName || !requestId || !budgetPeriod) {
      return NextResponse.json(
        { success: false, error: "Missing file, fileName, requestId, or budgetPeriod" },
        { status: 400 },
      );
    }

    // Multipart (non-resumable) Drive uploads are only reliable up to a
    // moderate size — matches the bump documented in CLAUDE.md ("drop the
    // size cap" once real upload is wired up) without going so large that
    // a single-shot multipart upload becomes flaky.
    const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { success: false, error: `${fileName} is larger than 20MB` },
        { status: 400 },
      );
    }

    const folderId = await createRequestFolder(accessToken, requestId, budgetPeriod);
    const { fileId, url } = await uploadFileToDrive(
      accessToken,
      file,
      fileName,
      file.type || "application/octet-stream",
      folderId,
    );

    return NextResponse.json({ success: true, url, fileId, fileName });
  } catch (err) {
    if (err instanceof DriveAuthError) {
      // `error: "reauth_required"` stays a stable sentinel the client
      // already branches on (see RequestForm.tsx#uploadFileEntry) — but a
      // 403 for "insufficient scope" and a 401 for "token expired" need
      // very different fixes, so `detail` carries Google's actual message
      // instead of collapsing both into the same generic client copy.
      console.error("[upload-to-drive] DriveAuthError:", err.googleMessage);
      return NextResponse.json(
        { success: false, error: "reauth_required", detail: err.googleMessage },
        { status: 401 },
      );
    }
    // handleApiError already logs the full error and returns err.message as
    // `error` in the response — lib/google-drive.ts's throw sites now embed
    // Google's actual response body in that message (see the console.error
    // calls next to each throw there for the full, unclipped body too).
    console.error("[upload-to-drive] upload failed:", err);
    return handleApiError(err);
  }
}
