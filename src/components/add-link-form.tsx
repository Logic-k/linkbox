"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { suggestTags } from "@/lib/categorize";
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
  | { status: "ok"; data: Metadata; requestedUrl: string }
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
  const abortRef = useRef<AbortController | null>(null);
  // 사용자가 태그를 직접 고치면 자동완성으로 덮어쓰지 않는다
  const tagsEdited = useRef(false);
  const autoFilled = useRef(false);

  const fetchMetadata = useCallback(async (normalized: string, signal: AbortSignal) => {
    const id = ++requestId.current;
    setFetchState({ status: "loading" });
    try {
      const res = await fetch(`/api/metadata?url=${encodeURIComponent(normalized)}`, { signal });
      const json = await res.json();
      if (id !== requestId.current) return;
      if (!res.ok) {
        setFetchState({ status: "error", message: json.error ?? "불러오기 실패" });
      } else {
        setFetchState({ status: "ok", data: json, requestedUrl: normalized });
      }
    } catch {
      if (id === requestId.current && !signal.aborted) {
        setFetchState({ status: "error", message: "네트워크 오류" });
      }
    }
  }, []);

  useEffect(() => {
    // 입력이 바뀌면 진행 중인 요청을 즉시 무효화 — 이전 URL의 결과가 남지 않도록
    abortRef.current?.abort();
    requestId.current += 1;
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setFetchState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => fetchMetadata(normalized, controller.signal), 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, fetchMetadata]);

  useEffect(() => {
    if (initialUrl) memoRef.current?.focus();
  }, [initialUrl]);

  // URL/제목이 준비되면 태그를 자동으로 제안한다 — 사용자가 건드린 적 없을 때만
  useEffect(() => {
    if (tagsEdited.current) return;
    const normalized = normalizeUrl(url);
    if (!normalized) {
      if (autoFilled.current) {
        autoFilled.current = false;
        setTags("");
      }
      return;
    }
    const title =
      fetchState.status === "ok" && fetchState.requestedUrl === normalized
        ? fetchState.data.title
        : "";
    const suggested = suggestTags(normalized, title);
    if (suggested.length) {
      autoFilled.current = true;
      setTags(suggested.join(", "));
    }
  }, [url, fetchState]);

  const canSave = normalizeUrl(url) !== null;

  const submit = () => {
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    const meta =
      fetchState.status === "ok" && fetchState.requestedUrl === normalized
        ? fetchState.data
        : undefined;
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
    tagsEdited.current = false;
    autoFilled.current = false;
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
        // biome-ignore lint/a11y/noAutofocus: 이 입력이 앱의 유일한 시작점이라 로드 시 포커스가 의도된 동작
        autoFocus
      />

      {fetchState.status === "loading" && (
        <div className="fetch-preview">미리보기 불러오는 중…</div>
      )}
      {fetchState.status === "ok" && (
        <div className="fetch-preview">
          {fetchState.data.favicon && <img src={fetchState.data.favicon} alt="" />}
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
          placeholder="태그 (쉼표로 구분 — 링크를 넣으면 자동 제안)"
          value={tags}
          onChange={(e) => {
            tagsEdited.current = true;
            setTags(e.target.value);
          }}
        />
        <button type="submit" className="primary-btn" disabled={!canSave}>
          <Plus size={16} style={{ verticalAlign: "-3px", marginRight: 4 }} />
          저장
        </button>
      </div>
    </form>
  );
}
