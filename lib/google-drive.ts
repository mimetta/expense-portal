// Server-only helpers for uploading /submit attachments straight to Google
// Drive using the *signed-in user's own* OAuth access token (Supabase
// Auth's `session.provider_token`) rather than a service account — no
// separate Google Cloud service-account credential to provision, at the
// cost of the limitations documented in app/api/upload-to-drive/route.ts's
// header comment (token expiry, required OAuth scope, folder sharing).
// Every function here expects to be called from a Next.js Route Handler
// (Node runtime), never from the browser directly.

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

// Root "Expense Portal" folder in Drive that every request's files live
// under, as an Env var so it can be repointed without a code change —
// falls back to the literal ID from the original spec.
export const DRIVE_ROOT_FOLDER_ID =
  process.env.NEXT_PUBLIC_GOOGLE_DRIVE_FOLDER_ID || "1r0FFSMf_whiXK6PL3JGXiRSyN_84E_4x";

// Thrown when Google rejects the request's access token (expired/revoked,
// or missing the Drive scope) — the route handler catches this specifically
// and reports `{ error: "reauth_required" }` rather than a generic 500.
export class DriveAuthError extends Error {
  constructor(message = "Google Drive access token is invalid or expired") {
    super(message);
    this.name = "DriveAuthError";
  }
}

async function driveFetch(accessToken: string, url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new DriveAuthError();
  }
  return res;
}

// Drive filenames can contain single quotes, which would otherwise break
// out of the `q` query string's quoted literals.
function escapeForDriveQuery(value: string): string {
  return value.replace(/'/g, "\\'");
}

export async function getOrCreateFolder(
  accessToken: string,
  parentId: string,
  folderName: string,
): Promise<string> {
  const q = `name='${escapeForDriveQuery(folderName)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await driveFetch(
    accessToken,
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
  );
  if (!searchRes.ok) {
    throw new Error(`Drive folder lookup failed: ${await searchRes.text()}`);
  }
  const searchBody = (await searchRes.json()) as { files?: { id: string }[] };
  if (searchBody.files && searchBody.files.length > 0) {
    return searchBody.files[0].id;
  }

  const createRes = await driveFetch(accessToken, DRIVE_FILES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Drive folder creation failed: ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

// requestId/budgetPeriod are provided by the caller (see
// app/api/upload-to-drive/route.ts) — always the real EXP-YYYY-MM-NNNNNN
// id, never a placeholder (see that route's header comment for why a
// create-mode submission uploads its files only after the request row,
// and therefore its real id, already exists).
export async function createRequestFolder(
  accessToken: string,
  requestId: string,
  budgetPeriod: string,
): Promise<string> {
  const monthFolderId = await getOrCreateFolder(accessToken, DRIVE_ROOT_FOLDER_ID, budgetPeriod);
  return getOrCreateFolder(accessToken, monthFolderId, requestId);
}

export async function uploadFileToDrive(
  accessToken: string,
  fileBytes: Blob,
  fileName: string,
  mimeType: string,
  folderId: string,
): Promise<{ fileId: string; url: string }> {
  const metadata = { name: fileName, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", fileBytes, fileName);

  const uploadRes = await driveFetch(
    accessToken,
    `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`,
    { method: "POST", body: form },
  );
  if (!uploadRes.ok) {
    throw new Error(`Drive upload failed: ${await uploadRes.text()}`);
  }
  const uploaded = (await uploadRes.json()) as { id: string };

  const permRes = await driveFetch(accessToken, `${DRIVE_FILES_URL}/${uploaded.id}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!permRes.ok) {
    throw new Error(`Drive permission update failed: ${await permRes.text()}`);
  }

  return { fileId: uploaded.id, url: `https://drive.google.com/file/d/${uploaded.id}/view` };
}
