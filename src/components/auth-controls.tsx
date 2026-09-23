"use client";

import type { Session } from "@supabase/supabase-js";
import { Cloud, CloudOff, Loader2, LogOut } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SyncStatus } from "@/lib/sync";

const STATUS_LABEL: Record<SyncStatus, string> = {
  off: "로컬",
  syncing: "동기화 중…",
  synced: "동기화됨",
  error: "동기화 실패",
};

export function AuthControls({
  session,
  syncStatus,
}: {
  session: Session | null;
  syncStatus: SyncStatus;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Supabase env가 없으면 로컬 전용 모드 — 버튼 자체를 숨긴다
  if (!supabase) return null;
  const client = supabase;

  const sendMagicLink = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const { error: err } = await client.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (err) setError("전송에 실패했습니다. 이메일을 확인해주세요");
    else setSent(true);
  };

  const signInGoogle = async () => {
    setBusy(true);
    await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    setBusy(false);
  };

  const statusLabel = STATUS_LABEL[syncStatus];
  const StatusIcon =
    syncStatus === "synced" ? Cloud : syncStatus === "syncing" ? Loader2 : CloudOff;

  return (
    <div className="auth-controls">
      <button type="button" className="sync-button" onClick={() => setOpen((v) => !v)}>
        <StatusIcon size={15} className={syncStatus === "syncing" ? "spin" : undefined} />
        {session ? statusLabel : "로그인·동기화"}
      </button>

      {open && (
        <div className="auth-popover">
          {session ? (
            <>
              <div className="auth-email">{session.user.email}</div>
              <div className={`sync-status ${syncStatus}`}>{statusLabel}</div>
              <button type="button" className="auth-action" onClick={() => client.auth.signOut()}>
                <LogOut size={14} /> 로그아웃
              </button>
            </>
          ) : sent ? (
            <p className="auth-note">메일함을 확인해 로그인 링크를 눌러주세요.</p>
          ) : (
            <>
              <input
                type="email"
                placeholder="이메일 주소"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMagicLink()}
              />
              <button
                type="button"
                className="auth-action"
                onClick={sendMagicLink}
                disabled={busy || !email.trim()}
              >
                로그인 링크 보내기
              </button>
              <button
                type="button"
                className="auth-action ghost"
                onClick={signInGoogle}
                disabled={busy}
              >
                Google로 계속하기
              </button>
              {error && <p className="auth-error">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
