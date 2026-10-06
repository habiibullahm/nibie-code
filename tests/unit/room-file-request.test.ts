import { describe, expect, it } from "vitest";
import { readRoomFileForm } from "../../lib/files/request";

describe("bounded Room-file multipart parsing", () => {
  it("rejects an oversized declared request before reading its body", async () => {
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { reads++; controller.enqueue(new Uint8Array([1])); },
    }, { highWaterMark: 0 });
    const request = {
      headers: new Headers({ "content-type": "multipart/form-data; boundary=x", "content-length": "11" }),
      body,
    } as unknown as Request;

    await expect(readRoomFileForm(request, 10)).resolves.toEqual({ tooLarge: true });
    expect(reads).toBe(0);
  });

  it("stops reading and cancels a stream once the bounded request size is exceeded", async () => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
      },
      cancel() { cancelled++; },
    });
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body,
      // @ts-expect-error Node-specific fetch option
      duplex: "half",
    });

    await expect(readRoomFileForm(request, 10)).resolves.toEqual({ tooLarge: true });
    expect(cancelled).toBe(1);
  });

  it("parses a bounded multipart body", async () => {
    const form = new FormData();
    form.set("roomId", "room-1");
    const request = new Request("http://localhost/upload", { method: "POST", body: form });

    const result = await readRoomFileForm(request, 1024);
    expect(result).toHaveProperty("form");
    if ("form" in result) expect(result.form.get("roomId")).toBe("room-1");
  });
});
