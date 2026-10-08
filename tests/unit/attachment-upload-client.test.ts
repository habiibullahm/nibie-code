import { describe, expect, it, vi } from "vitest";

const { Upload } = vi.hoisted(() => {
  class FakeUpload {
    static last: FakeUpload | null = null;
    options: {
      endpoint: string;
      headers?: Record<string, string>;
      metadata?: Record<string, string>;
      chunkSize?: number;
      onError?: (error: Error) => void;
      onSuccess?: () => void;
    };
    constructor(_file: File, options: FakeUpload["options"]) {
      this.options = options;
      FakeUpload.last = this;
    }
    start() {
      queueMicrotask(() => this.options.onSuccess?.());
    }
    abort() {
      return Promise.resolve();
    }
  }
  return { Upload: FakeUpload };
});

vi.mock("tus-js-client", () => ({ Upload }));

import { putFileViaSignedTus } from "../../lib/attachments/upload-client";
import { ATTACHMENT_TUS_CHUNK_SIZE, CHAT_ATTACHMENT_STAGING_BUCKET } from "../../lib/attachments/limits";

describe("putFileViaSignedTus", () => {
  it("starts a signed TUS upload against the staging bucket", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const result = await putFileViaSignedTus(file, {
      path: "user/drafts/id/id.txt",
      token: "signed-token",
      bucket: CHAT_ATTACHMENT_STAGING_BUCKET,
      tusEndpoint: "https://example.supabase.co/storage/v1/upload/resumable/sign",
      contentType: "text/plain",
    });
    expect(result).toEqual({ ok: true });
    expect(Upload.last?.options.endpoint).toBe("https://example.supabase.co/storage/v1/upload/resumable/sign");
    expect(Upload.last?.options.headers).toEqual({ "x-signature": "signed-token" });
    expect(Upload.last?.options.metadata).toMatchObject({
      bucketName: CHAT_ATTACHMENT_STAGING_BUCKET,
      objectName: "user/drafts/id/id.txt",
      contentType: "text/plain",
    });
    expect(Upload.last?.options.chunkSize).toBe(ATTACHMENT_TUS_CHUNK_SIZE);
  });

  it("fails when aborted before start", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await putFileViaSignedTus(new File(["x"], "a.txt"), {
      path: "p",
      token: "t",
      bucket: CHAT_ATTACHMENT_STAGING_BUCKET,
      tusEndpoint: "https://example.supabase.co/storage/v1/upload/resumable/sign",
      contentType: "text/plain",
    }, controller.signal);
    expect(result).toEqual({ ok: false });
  });
});
