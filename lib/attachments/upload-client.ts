// Browser helper: PUT a file to a Supabase signed upload URL (same FormData shape as storage-js for Blob/File).

export async function putFileToSignedUploadUrl(signedUrl: string, file: File, signal?: AbortSignal): Promise<{ ok: true } | { ok: false }> {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  try {
    const response = await fetch(signedUrl, { method: "PUT", body, signal });
    if (!response.ok) return { ok: false };
    return { ok: true };
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return { ok: false };
  }
}
