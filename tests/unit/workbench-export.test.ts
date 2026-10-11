import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/workbench/documents/[id]/export/route";

const { createClient, getUser, readDocument } = vi.hoisted(() => ({
  createClient: vi.fn(), getUser: vi.fn(), readDocument: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
vi.mock("@/lib/auth/get-user", () => ({ getAuthenticatedUser: getUser }));
vi.mock("@/lib/workbench/read", () => ({ getWorkbenchDocument: readDocument }));
const id = "6f0c1c3e-9a0b-4d1e-8f2a-1b2c3d4e5f60";
const context = { params: Promise.resolve({ id }) };
const request = (format: string) => new Request(`http://localhost/api/workbench/documents/${id}/export?format=${format}`);

describe("Workbench authenticated export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({});
    getUser.mockResolvedValue({ id: "owner" });
    readDocument.mockResolvedValue({ document: { title: "Café 日本語", content: "<think>private reasoning</think>## Catatan\n\nHello **world** 日本語" }, error: null });
  });

  it("requires authentication before reading a document", async () => {
    getUser.mockResolvedValue(null);
    expect((await GET(request("md"), context)).status).toBe(401);
    expect(readDocument).not.toHaveBeenCalled();
  });

  it("rejects unavailable documents and unsupported formats", async () => {
    expect((await GET(request("pdf"), context)).status).toBe(400);
    expect(readDocument).not.toHaveBeenCalled();
    readDocument.mockResolvedValue({ document: null, error: null });
    expect((await GET(request("md"), context)).status).toBe(404);
  });

  it.each(["md", "txt"])("exports UTF-8 %s without reasoning or cacheable private content", async format => {
    const response = await GET(request(format), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toContain("charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''Caf%C3%A9-%E6%97%A5%E6%9C%AC%E8%AA%9E");
    const body = await response.text();
    expect(body).not.toContain("private reasoning");
    expect(body).not.toContain("<think>");
    expect(body).toContain("日本語");
    if (format === "md") expect(body).toContain("## Catatan\n\nHello **world**");
    else expect(body).toBe("Catatan\n\nHello world 日本語");
  });
});
