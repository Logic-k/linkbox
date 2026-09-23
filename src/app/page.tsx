"use client";

import { Download, Link2, Search, Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AddLinkForm } from "@/components/add-link-form";
import { AuthControls } from "@/components/auth-controls";
import { LinkCard } from "@/components/link-card";
import { GithubSession } from "@/lib/github";
import { exportJson, parseImport, useLinks } from "@/lib/store";
import { SyncEngine } from "@/lib/sync";

function sharedUrlFrom(params: URLSearchParams): string {
  for (const key of ["url", "text", "title"]) {
    const value = params.get(key);
    if (!value) continue;
    const match = value.match(/https?:\/\/\S+/);
    if (match) return match[0];
  }
  return "";
}

function Home() {
  const searchParams = useSearchParams();
  const sharedUrl = useMemo(() => sharedUrlFrom(searchParams), [searchParams]);

  const {
    items,
    hydrated,
    allTags,
    storageError,
    syncStatus,
    engineHooks,
    attachEngine,
    add,
    remove,
    togglePin,
    editMemo,
    mergeImported,
  } = useLinks();
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [syncPromptDismissed, setSyncPromptDismissed] = useState(true);
  const [syncOpen, setSyncOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const githubSession = useMemo(() => new GithubSession(), []);

  const SYNC_PROMPT_KEY = "linkbox:sync-prompt:v1";

  // "나중에"를 누른 적 있으면 첫 접속 안내를 다시 띄우지 않는다
  useEffect(() => {
    setSyncPromptDismissed(localStorage.getItem(SYNC_PROMPT_KEY) === "1");
  }, []);

  const dismissSyncPrompt = () => {
    localStorage.setItem(SYNC_PROMPT_KEY, "1");
    setSyncPromptDismissed(true);
  };

  // 이전에 저장된 토큰이 있으면 바로 연결을 복원한다
  useEffect(() => {
    let alive = true;
    githubSession.restore().then((ok) => {
      if (alive && ok) setConnected(true);
    });
    return () => {
      alive = false;
    };
  }, [githubSession]);

  // 연결되면 SyncEngine 장착. 해제하면 로컬 데이터는 그대로 두고 로컬 모드로 돌아간다
  useEffect(() => {
    if (!connected) {
      attachEngine(null);
      return;
    }
    const engine = new SyncEngine(() => githubSession.getToken(), engineHooks);
    attachEngine(engine);
    engine.start();
    return () => engine.detach();
  }, [githubSession, connected, engineHooks, attachEngine]);

  useEffect(() => {
    if (activeTag && !allTags.includes(activeTag)) setActiveTag(null);
  }, [allTags, activeTag]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (activeTag && !item.tags.includes(activeTag)) return false;
      if (!q) return true;
      return [item.title, item.memo, item.url, item.siteName ?? "", ...item.tags]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [items, query, activeTag]);

  // 폰에서는 파일 다운로드가 불편해서, 공유 시트 → 클립보드 → 다운로드 순으로 시도한다
  const doExport = async () => {
    const json = exportJson(items);
    const name = `linkbox-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([json], name, { type: "application/json" });
    if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "링크박스 백업" });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // 사용자가 공유를 취소
      }
    }
    try {
      await navigator.clipboard.writeText(json);
      alert("JSON을 클립보드에 복사했습니다. 다른 기기에서 '가져오기 → 붙여넣기'로 넣으세요.");
      return;
    } catch {
      // 클립보드도 막힌 환경이면 파일 다운로드로 폴백
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importItems = (text: string) => {
    try {
      const added = mergeImported(parseImport(text));
      alert(`${added}개 링크를 가져왔습니다`);
      setImportOpen(false);
      setPasteText("");
    } catch {
      alert("JSON 형식이 올바르지 않습니다. 내보내기한 내용을 그대로 붙여넣어주세요.");
    }
  };

  const doImportFile = async (file: File) => {
    try {
      importItems(await file.text());
    } catch {
      alert("파일을 읽지 못했습니다. 내보내기한 JSON 파일인지 확인해주세요.");
    }
  };

  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="logo">
            <Link2 size={17} />
          </span>
          링크박스
          <span className="count">{hydrated ? `${items.length}개` : ""}</span>
        </h1>
        <div className="header-actions">
          <AuthControls
            session={githubSession}
            connected={connected}
            syncStatus={syncStatus}
            onSession={setConnected}
            open={syncOpen}
            onOpenChange={setSyncOpen}
          />
          <button type="button" className="icon-btn" onClick={doExport} title="JSON 내보내기">
            <Download size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setImportOpen(true)}
            title="가져오기"
          >
            <Upload size={16} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) doImportFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      {!connected && !syncPromptDismissed && (
        <div className="sync-prompt">
          <p className="sync-prompt-text">
            폰·PC에서 같은 링크를 보려면 GitHub 계정으로 연결하세요. 토큰 붙여넣기 한 번이면 이후
            저장은 자동으로 동기화됩니다.
          </p>
          <div className="sync-prompt-actions">
            <button type="button" className="auth-action" onClick={() => setSyncOpen(true)}>
              GitHub로 연결하기
            </button>
            <button type="button" className="auth-action ghost" onClick={dismissSyncPrompt}>
              나중에
            </button>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="paste-backdrop">
          <button
            type="button"
            className="paste-close"
            aria-label="가져오기 닫기"
            onClick={() => setImportOpen(false)}
          />
          <div className="paste-modal" role="dialog" aria-modal="true" aria-label="링크 가져오기">
            <p className="auth-note">다른 기기에서 복사한 JSON을 붙여넣거나 파일을 선택하세요.</p>
            <textarea
              className="paste-area"
              placeholder='{"version":1, "items":[…]}'
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
            />
            <div className="paste-actions">
              <button
                type="button"
                className="auth-action"
                onClick={() => importItems(pasteText)}
                disabled={!pasteText.trim()}
              >
                붙여넣기로 가져오기
              </button>
              <button
                type="button"
                className="auth-action ghost"
                onClick={() => fileRef.current?.click()}
              >
                파일 선택
              </button>
              <button
                type="button"
                className="auth-action ghost"
                onClick={() => setImportOpen(false)}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      <AddLinkForm key={sharedUrl} initialUrl={sharedUrl} onAdd={add} />

      {storageError && (
        <div className="storage-error">
          브라우저 저장 공간이 부족하거나 차단되어 저장되지 않았습니다. 내보내기로 백업 후 일부를
          지워주세요.
        </div>
      )}

      <div className="toolbar">
        <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>
          <Search size={15} style={{ position: "absolute", left: 11, color: "var(--text-dim)" }} />
          <input
            className="search"
            style={{ paddingLeft: 32 }}
            placeholder="제목, 메모, 태그 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="tag-chips">
          <button
            type="button"
            className={`chip${activeTag === null ? " active" : ""}`}
            onClick={() => setActiveTag(null)}
          >
            전체
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`chip${activeTag === tag ? " active" : ""}`}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      <div className="card-list">
        {filtered.map((item) => (
          <LinkCard
            key={item.id}
            item={item}
            onTogglePin={togglePin}
            onRemove={remove}
            onEditMemo={editMemo}
          />
        ))}
      </div>

      {hydrated && filtered.length === 0 && (
        <div className="empty">
          {items.length === 0 ? (
            <>
              저장된 링크가 없습니다.
              <br />위 입력창에 링크를 붙여넣고 한줄 메모를 남겨보세요.
              <div className="hint">
                팁: 폰에서 홈 화면에 추가하면 스레드 앱의 공유 버튼으로 바로 저장할 수 있습니다.
              </div>
            </>
          ) : (
            "검색 결과가 없습니다."
          )}
        </div>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}
