export type BoundedFormResult = { form: FormData } | { tooLarge: true } | { invalid: true };

export async function readRoomFileForm(request: Request, maxBytes: number): Promise<BoundedFormResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isSafeInteger(parsedLength) && parsedLength > maxBytes) return { tooLarge: true };
  }

  if (!request.body) return { invalid: true };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { invalid: true };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const response = new Response(bytes, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    });
    return { form: await response.formData() };
  } catch {
    return { invalid: true };
  }
}
