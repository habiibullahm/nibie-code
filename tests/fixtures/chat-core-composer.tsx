"use client";

import { useRef, useState } from "react";
import { readChatSse, ChatStreamServerError } from "@/lib/ai/sse";
import { ChatComposer } from "@/components/chat-composer";
import { modelPickerCopy } from "@/lib/chat/models";
import type { ChatModel } from "@/lib/chat/validation";

// Isolated composer lifecycle fixture. Browser tests intercept /api/chat; no database is used.
export function ChatCoreComposerFixture() {
  const [streaming, setStreaming] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("idle");
  const [notice, setNotice] = useState("");
  const [requests, setRequests] = useState(0);
  const [stops, setStops] = useState(0);
  const [model, setModel] = useState<ChatModel>("Balanced");
  const current = useRef<AbortController | null>(null);
  async function send(content: string) {
    if (current.current) return;
    const controller = new AbortController();
    current.current = controller;
    setRequests((count) => count + 1);
    setStreaming(true);
    setText(""); setStatus("streaming"); setNotice("");
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, model }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error("Provider request failed.");
      for await (const event of readChatSse(response.body)) {
        if (event.type === "delta") setText((current) => current + event.text);
        if (event.type === "status") setStatus(event.status);
      }
    } catch (error) {
      setStatus(controller.signal.aborted ? "interrupted" : "error");
      if (!controller.signal.aborted) setNotice(error instanceof ChatStreamServerError ? error.message : "Generation failed.");
    }
    finally { if (current.current === controller) current.current = null; setStreaming(false); }
  }
  return <main style={{ maxWidth: 680, margin: "auto", padding: 16 }}>
    <p aria-label="Assistant text">{text}</p><output aria-label="Response status">{status}</output><p role="status">{notice}</p>
    <output aria-label="Requests">{requests}</output><output aria-label="Stops">{stops}</output>
    <ChatComposer sending={false} streaming={streaming} mode={model}
      models={(["Fast", "Balanced", "High"] as const).map((id) => ({ id, ...modelPickerCopy[id] }))}
      onModelChange={setModel} savingMode={false}
      diagnostics={{ sources: [], recentMessageCount: 0 }} onEditProfile={() => {}} caption="Composer test fixture"
      onSubmit={send} onStop={() => { setStops((count) => count + 1); current.current?.abort(); }} onAttach={() => {}}
      roomItems={[{ value: "", label: "General" }]} roomId="" roomLabel="General" roomSelectionNotice={null} roomsLoading={false} onRoomChange={() => {}} />
  </main>;
}
