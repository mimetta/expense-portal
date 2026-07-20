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
// `googleMessage` carries whatever Google's own response body said (a 401
// from an expired token and a 403 from a missing/insufficient scope both
// land here, and read very differently — see the route's header comment),
// so the route can pass the real reason back to the client instead of a
// single generic sentinel.
export class DriveAuthError extends Error {
  googleMessage: string;
  constructor(googleMessage: string) {
    super(`Google Drive access token was rejected: ${googleMessage}`);
    this.name = "DriveAuthError";
    this.googleMessage = googleMessage;
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
    const bodyText = await res.text().catch(() => "");
    console.error(`[google-drive] ${res.status} from ${url}:`, bodyText || "(empty body)");
    throw new DriveAuthError(bodyText || res.statusText || `HTTP ${res.status}`);
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
    const bodyText = await searchRes.text();
    console.error(`[google-drive] folder lookup failed (${searchRes.status}) for "${folderName}" in ${parentId}:`, bodyText);
    throw new Error(`Drive folder lookup failed (${searchRes.status}): ${bodyText}`);
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
    const bodyText = await createRes.text();
    console.error(`[google-drive] folder creation failed (${createRes.status}) for "${folderName}" in ${parentId}:`, bodyText);
    throw new Error(`Drive folder creation failed (${createRes.status}): ${bodyText}`);
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
  console.log(`[google-drive] resolving folder for ${budgetPeriod}/${requestId} under root ${DRIVE_ROOT_FOLDER_ID}`);
  const monthFolderId = await getOrCreateFolder(accessToken, DRIVE_ROOT_FOLDER_ID, budgetPeriod);
  const requestFolderId = await getOrCreateFolder(accessToken, monthFolderId, requestId);
  console.log(`[google-drive] resolved folder ${requestFolderId} for ${budgetPeriod}/${requestId}`);
  return requestFolderId;
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
    const bodyText = await uploadRes.text();
    console.error(`[google-drive] upload failed (${uploadRes.status}) for "${fileName}" into folder ${folderId}:`, bodyText);
    throw new Error(`Drive upload failed (${uploadRes.status}): ${bodyText}`);
  }
  const uploaded = (await uploadRes.json()) as { id: string };
  console.log(`[google-drive] uploaded "${fileName}" as file id ${uploaded.id} in folder ${folderId}`);

  const permRes = await driveFetch(accessToken, `${DRIVE_FILES_URL}/${uploaded.id}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!permRes.ok) {
    const bodyText = await permRes.text();
    console.error(`[google-drive] permission update failed (${permRes.status}) for file ${uploaded.id}:`, bodyText);
    throw new Error(`Drive permission update failed (${permRes.status}): ${bodyText}`);
  }

  return { fileId: uploaded.id, url: `https://drive.google.com/file/d/${uploaded.id}/view` };
}
