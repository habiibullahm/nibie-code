"use client";

import { Upload } from "tus-js-client";
import { ATTACHMENT_TUS_CHUNK_SIZE } from "@/lib/attachments/limits";

export type TusUploadTicket = {
  path: string;
  token: string;
  bucket: string;
  tusEndpoint: string;
  contentType: string;
};

// Browser TUS resumable upload to Supabase Storage using a signed upload token (x-signature).
// File bytes never pass through a Vercel Function body.
export function putFileViaSignedTus(file: File, ticket: TusUploadTicket, signal?: AbortSignal): Promise<{ ok: true } | { ok: false }> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false });
      return;
    }

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(ok ? { ok: true } : { ok: false });
    };

    const upload = new Upload(file, {
      endpoint: ticket.tusEndpoint,
      retryDelays: [0, 1000, 3000, 5000],
      headers: { "x-signature": ticket.token },
      metadata: {
        bucketName: ticket.bucket,
        objectName: ticket.path,
        contentType: ticket.contentType || file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: ATTACHMENT_TUS_CHUNK_SIZE,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      onError: () => finish(false),
      onSuccess: () => finish(true),
    });

    const onAbort = () => {
      upload.abort(true).then(() => finish(false), () => finish(false));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    upload.start();
  });
}
