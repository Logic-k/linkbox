"use client";

import { Cloud, CloudOff, ExternalLink, Loader2, LogOut } from "lucide-react";
import { useState } from "react";
import type { GithubSession } from "@/lib/github";
import type { SyncStatus } from "@/lib/sync";

const STATUS_LABEL: Record<SyncStatus, string> = {
  off: "동기화 꺼짐",
  syncing: "동기화 중…",
  synced: "동기화됨",
  error: "동기화 오류",
};

const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=gist&description=linkbox";

export function AuthControls({
  session,
  connected,
  syncStatus,
  onSession,
  open,
  onOpenChange,
}: {
  session: GithubSession | null;
  connected: boolean;
  syncStatus: SyncStatus;
  onSession: (connected: boolean) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");

  if (!session) return null;

  // 붙여넣은 토큰을 검증하고 저장한다 — 한 번만 하면 이후 자동
  const connect = async () => {
    setBusy(true);
    setError(null);
    const ok = await session.connect(token.trim());
    setBusy(false);
    if (!ok) {
      setError("토큰이 유효하지 않습니다. gist 권한이 있는지 확인해주세요");
      return;
    }
    setToken("");
    onSession(true);
  };

  const disconnect = async () => {
    await session.signOut();
    onSession(false);
  };

  const statusLabel = STATUS_LABEL[syncStatus];
  const StatusIcon =
    syncStatus === "synced" ? Cloud : syncStatus === "syncing" ? Loader2 : CloudOff;

  return (
    <div className="auth-controls">
      <button type="button" className="sync-button" onClick={() => onOpenChange(!open)}>
        <StatusIcon size={15} className={syncStatus === "syncing" ? "spin" : undefined} />
        <span className="sync-label">{connected ? statusLabel : "GitHub 동기화"}</span>
      </button>

      {open && (
        <div className="auth-popover">
          {connected ? (
            <>
              <div className="auth-email">GitHub Gist에 동기화 중</div>
              <div className={`sync-status ${syncStatus}`}>{statusLabel}</div>
              {syncStatus === "error" && (
                <button type="button" className="auth-action" onClick={connect} disabled={busy}>
                  다시 연결
                </button>
              )}
              <button type="button" className="auth-action" onClick={disconnect}>
                <LogOut size={14} /> 연결 해제
              </button>
            </>
          ) : (
            <>
              <p className="auth-note">
                GitHub의 비공개 Gist에 linkbox.json을 저장합니다. 폰/PC가 같은 파일을 읽고 씁니다.
              </p>
              <a className="auth-link" href={TOKEN_URL} target="_blank" rel="noreferrer">
                토큰 만들기 (gist 권한만 체크) <ExternalLink size={12} />
              </a>
              <input
                className="token-input"
                type="password"
                placeholder="ghp_… 토큰 붙여넣기"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button
                type="button"
                className="auth-action"
                onClick={connect}
                disabled={busy || !token.trim()}
              >
                {busy ? "확인 중…" : "토큰으로 연결하기"}
              </button>
              {error && <p className="auth-error">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
