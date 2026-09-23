"use client";

import { Cloud, CloudOff, Loader2, LogOut } from "lucide-react";
import { useState } from "react";
import type { DriveSession } from "@/lib/drive";
import type { SyncStatus } from "@/lib/sync";

const STATUS_LABEL: Record<SyncStatus, string> = {
  off: "동기화 꺼짐",
  syncing: "동기화 중…",
  synced: "동기화됨",
  error: "동기화 오류",
};

export function AuthControls({
  session,
  connected,
  syncStatus,
  onSession,
}: {
  session: DriveSession | null;
  connected: boolean;
  syncStatus: SyncStatus;
  onSession: (connected: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GOOGLE_CLIENT_ID env가 없으면 로컬 전용 모드 — 버튼 자체를 숨긴다
  if (!session) return null;

  const connect = async () => {
    setBusy(true);
    setError(null);
    const ok = await session.signIn();
    setBusy(false);
    if (!ok) {
      setError("연결에 실패했습니다. 다시 시도해주세요");
      return;
    }
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
      <button type="button" className="sync-button" onClick={() => setOpen((v) => !v)}>
        <StatusIcon size={15} className={syncStatus === "syncing" ? "spin" : undefined} />
        {connected ? statusLabel : "Drive 동기화"}
      </button>

      {open && (
        <div className="auth-popover">
          {connected ? (
            <>
              <div className="auth-email">Drive의 '링크박스' 폴더에 동기화 중</div>
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
                Google Drive에 '링크박스' 폴더를 만들어 링크를 저장합니다. 폰/PC가 같은 파일을 읽고
                씁니다.
              </p>
              <button type="button" className="auth-action" onClick={connect} disabled={busy}>
                Google로 연결하기
              </button>
              {error && <p className="auth-error">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
