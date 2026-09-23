"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LinkDraft } from "@/lib/store";

type Metadata = {
  url: string;
  title: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
};

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: Metadata }
  | { status: "error"; message: string };

function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function AddLinkForm({
  initialUrl,
  onAdd,
}: {
  initialUrl: string;
  onAdd: (draft: LinkDraft) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [memo, setMemo] = useState("");
  const [tags, setTags] = useState("");
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const memoRef = useRef<HTMLTextAreaElement>(null);
  const requestId = useRef(0);

  const fetchMetadata = useCallback(async (normalized: string) => {
    const id = ++requestId.current;
    setFetchState({ status: "loading" });
    try {
      const res = await fetch(`/api/metadata?url=${encodeURIComponent(normalized)}`);
      const json = await res.json();
      if (id !== requestId.current) return;
      if (!res.ok) {
        setFetchState({ status: "error", message: json.error ?? "불러오기 실패" });
      } else {
        setFetchState({ status: "ok", data: json });
      }
    } catch {
      if (id === requestId.current) {
        setFetchState({ status: "error", message: "네트워크 오류" });
      }
    }
  }, []);

  useEffect(() => {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setFetchState({ status: "idle" });
      return;
    }
    const timer = setTimeout(() => fetchMetadata(normalized), 500);
    return () => clearTimeout(timer);
  }, [url, fetchMetadata]);

  useEffect(() => {
    if (initialUrl) memoRef.current?.focus();
  }, [initialUrl]);

  const canSave = normalizeUrl(url) !== null;

  const submit = () => {
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    const meta = fetchState.status === "ok" ? fetchState.data : undefined;
    onAdd({
      url: normalized,
      title: meta?.title ?? new URL(normalized).hostname,
      memo: memo.trim(),
      tags: tags
        .split(/[,\s]+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter(Boolean),
      image: meta?.image,
      favicon: meta?.favicon,
      siteName: meta?.siteName,
    });
    setUrl("");
    setMemo("");
    setTags("");
    setFetchState({ status: "idle" });
  };

  return (
    <form
      className="add-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        type="url"
        placeholder="링크 붙여넣기 (https://...)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        autoComplete="off"
        // biome-ignore lint/a11y/noAutofocus: 데스크톱에서 바로 붙여넣기용
        autoFocus
      />

      {fetchState.status === "loading" && (
        <div className="fetch-preview">미리보기 불러오는 중…</div>
      )}
      {fetchState.status === "ok" && (
        <div className="fetch-preview">
          {fetchState.data.favicon && (
            // biome-ignore lint/performance/noImgElement: 외부 파비콘은 최적화 불필요
            <img src={fetchState.data.favicon} alt="" />
          )}
          <span className="preview-title">{fetchState.data.title}</span>
        </div>
      )}
      {fetchState.status === "error" && (
        <div className="fetch-preview error">{fetchState.message} — 그래도 저장할 수 있습니다</div>
      )}

      <textarea
        ref={memoRef}
        placeholder="이 링크가 뭐지? (예: AI 메모리 기법 — 나중에 써먹기)"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        rows={2}
      />

      <div className="form-row">
        <input
          type="text"
          placeholder="태그 (쉼표로 구분, 예: ai, 도구)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <button type="submit" className="primary-btn" disabled={!canSave}>
          <Plus size={16} style={{ verticalAlign: "-3px", marginRight: 4 }} />
          저장
        </button>
      </div>
    </form>
  );
}
