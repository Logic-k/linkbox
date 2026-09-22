"use client";

import { Link2, Pin, PinOff, Trash2 } from "lucide-react";
import { useState } from "react";
import type { LinkItem } from "@/lib/store";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function LinkCard({
  item,
  onTogglePin,
  onRemove,
  onEditMemo,
}: {
  item: LinkItem;
  onTogglePin: (id: string) => void;
  onRemove: (id: string) => void;
  onEditMemo: (id: string, memo: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.memo);

  const commit = () => {
    onEditMemo(item.id, draft.trim());
    setEditing(false);
  };

  return (
    <article className={`card${item.pinned ? " pinned" : ""}`}>
      <div className="thumb">
        {item.image ? (
          // biome-ignore lint/performance/noImgElement: 외부 썸네일은 최적화 불필요
          <img src={item.image} alt="" />
        ) : item.favicon ? (
          // biome-ignore lint/performance/noImgElement: 외부 파비콘은 최적화 불필요
          <img className="favicon" src={item.favicon} alt="" />
        ) : (
          <Link2 size={22} color="var(--text-dim)" />
        )}
      </div>

      <div className="card-body">
        <a className="card-title" href={item.url} target="_blank" rel="noopener noreferrer">
          {item.title}
        </a>
        <div className="card-domain">
          {item.siteName ? `${item.siteName} · ` : ""}
          {domainOf(item.url)}
        </div>

        {editing ? (
          <textarea
            className="memo-edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                setDraft(item.memo);
                setEditing(false);
              }
            }}
            // biome-ignore lint/a11y/noAutofocus: 클릭으로만 진입하는 편집 필드
            autoFocus
            rows={2}
          />
        ) : (
          <button
            type="button"
            className={`card-memo${item.memo ? "" : " empty"}`}
            onClick={() => {
              setDraft(item.memo);
              setEditing(true);
            }}
            title="클릭해서 메모 수정"
          >
            {item.memo || "메모 추가…"}
          </button>
        )}

        {item.tags.length > 0 && (
          <div className="card-tags">
            {item.tags.map((tag) => (
              <span key={tag} className="card-tag">
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="card-date">{formatDate(item.createdAt)}</div>
      </div>

      <div className="card-actions">
        <button
          type="button"
          className="icon-btn"
          onClick={() => onTogglePin(item.id)}
          title={item.pinned ? "고정 해제" : "상단 고정"}
        >
          {item.pinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
        <button
          type="button"
          className="icon-btn danger"
          onClick={() => onRemove(item.id)}
          title="삭제"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}
