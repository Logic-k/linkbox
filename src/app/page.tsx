"use client";

import { Download, Link2, Search, Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AddLinkForm } from "@/components/add-link-form";
import { AuthControls } from "@/components/auth-controls";
import { LinkCard } from "@/components/link-card";
import { DriveSession } from "@/lib/drive";
import { exportJson, parseImport, useLinks } from "@/lib/store";
import { SyncEngine } from "@/lib/sync";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

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
  const fileRef = useRef<HTMLInputElement>(null);

  const driveSession = useMemo(
    () => (GOOGLE_CLIENT_ID ? new DriveSession(GOOGLE_CLIENT_ID) : null),
    [],
  );

  // 이전에 동의한 세션이면 팝업 없이 조용히 연결을 복원한다
  useEffect(() => {
    let alive = true;
    driveSession?.restore().then((ok) => {
      if (alive && ok) setConnected(true);
    });
    return () => {
      alive = false;
    };
  }, [driveSession]);

  // 연결되면 SyncEngine 장착. 해제하면 로컬 데이터는 그대로 두고 로컬 모드로 돌아간다
  useEffect(() => {
    if (!driveSession || !connected) {
      attachEngine(null);
      return;
    }
    const engine = new SyncEngine(() => driveSession.getToken(), engineHooks);
    attachEngine(engine);
    engine.start();
    return () => engine.detach();
  }, [driveSession, connected, engineHooks, attachEngine]);

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

  const doExport = () => {
    const blob = new Blob([exportJson(items)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `linkbox-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async (file: File) => {
    try {
      const imported = parseImport(await file.text());
      const added = mergeImported(imported);
      alert(`${added}개 링크를 가져왔습니다`);
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
            session={driveSession}
            connected={connected}
            syncStatus={syncStatus}
            onSession={setConnected}
          />
          <button type="button" className="icon-btn" onClick={doExport} title="JSON 내보내기">
            <Download size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => fileRef.current?.click()}
            title="JSON 가져오기"
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
              if (file) doImport(file);
              e.target.value = "";
            }}
          />
        </div>
      </header>

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
