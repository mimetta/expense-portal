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
export async function POST(request: Request) {
  try {
    await requireUser();

    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.provider_token;
    if (!accessToken) {
      return NextResponse.json({ success: false, error: "reauth_required" }, { status: 401 });
    }

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
      return NextResponse.json({ success: false, error: "reauth_required" }, { status: 401 });
    }
    return handleApiError(err);
  }
}
