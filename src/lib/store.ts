"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type LinkItem = {
  id: string;
  url: string;
  title: string;
  memo: string;
  tags: string[];
  image?: string;
  favicon?: string;
  siteName?: string;
  pinned: boolean;
  createdAt: number;
};

export type LinkDraft = {
  url: string;
  title: string;
  memo: string;
  tags: string[];
  image?: string;
  favicon?: string;
  siteName?: string;
};

const STORAGE_KEY = "linkbox:items:v1";

function isLinkItem(item: unknown): item is LinkItem {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as LinkItem).id === "string" &&
    typeof (item as LinkItem).url === "string"
  );
}

type Snapshot = { rev: number; items: LinkItem[] };

function loadSnapshot(): Snapshot {
  const empty: Snapshot = { rev: 0, items: [] };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    // 초기 포맷(배열)과 {rev, items} 스냅샷 포맷을 모두 읽는다
    const list = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(list)) return empty;
    const rev = typeof parsed?.rev === "number" ? parsed.rev : 0;
    return { rev, items: list.filter(isLinkItem) };
  } catch {
    return empty;
  }
}

function persist(items: LinkItem[], rev: number): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ rev, items }));
    return true;
  } catch {
    return false;
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useLinks() {
  const [items, setItems] = useState<LinkItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState(false);
  // 이 탭이 마지막으로 기록/관측한 스냅샷 리비전 — 저장소의 rev가 더 크면
  // 다른 탭이 쓴 뒤이므로 그쪽을 authoritative로 채택한다(삭제도 되살아나지 않음)
  const revRef = useRef(0);

  useEffect(() => {
    const snap = loadSnapshot();
    revRef.current = snap.rev;
    setItems(snap.items);
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY && e.key !== null) return;
      const next = loadSnapshot();
      revRef.current = next.rev;
      setItems(next.items);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // 읽기-수정-쓰기가 한 태스크 안에서 동기 실행되므로 다른 탭의 쓰기와는
  // 태스크 경계에서만 엇갈린다 — rev 비교로 최신쪽을 고른다
  const mutateAndPersist = useCallback(
    (mutate: (base: LinkItem[]) => LinkItem[]): LinkItem[] => {
      const snap = loadSnapshot();
      const base = snap.rev > revRef.current ? snap.items : items;
      const resolved = mutate(base);
      const rev = snap.rev + 1;
      if (persist(resolved, rev)) {
        revRef.current = rev;
        setStorageError(false);
      } else {
        // 쓰기 실패 시 rev를 올리지 않음 — 다음 mutation이 메모리 상태를 이어받아 재시도
        setStorageError(true);
      }
      setItems(resolved);
      return resolved;
    },
    [items],
  );

  const update = useCallback(
    (mutate: (prev: LinkItem[]) => LinkItem[]) => {
      mutateAndPersist(mutate);
    },
    [mutateAndPersist],
  );

  const add = useCallback(
    (draft: LinkDraft) => {
      const item: LinkItem = {
        id: createId(),
        pinned: false,
        createdAt: Date.now(),
        ...draft,
      };
      update((prev) => [item, ...prev]);
      return item;
    },
    [update],
  );

  const remove = useCallback(
    (id: string) => {
      update((prev) => prev.filter((item) => item.id !== id));
    },
    [update],
  );

  const togglePin = useCallback(
    (id: string) => {
      update((prev) =>
        prev.map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item)),
      );
    },
    [update],
  );

  const editMemo = useCallback(
    (id: string, memo: string) => {
      update((prev) => prev.map((item) => (item.id === id ? { ...item, memo } : item)));
    },
    [update],
  );

  const mergeImported = useCallback(
    (imported: LinkItem[]): number => {
      let count = 0;
      mutateAndPersist((base) => {
        const existing = new Set(base.map((i) => i.url));
        const fresh = imported.filter((i) => !existing.has(i.url));
        count = fresh.length;
        return [...base, ...fresh];
      });
      return count;
    },
    [mutateAndPersist],
  );

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const item of items) {
      for (const tag of item.tags) tags.add(tag);
    }
    return [...tags].sort((a, b) => a.localeCompare(b, "ko"));
  }, [items]);

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt),
    [items],
  );

  return {
    items: sorted,
    hydrated,
    allTags,
    storageError,
    add,
    remove,
    togglePin,
    editMemo,
    mergeImported,
  };
}

export function exportJson(items: LinkItem[]): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items }, null, 2);
}

// 가져오기는 url만 요구한다 — id가 없는 외부 포맷도 수용하고 나머지는 정규화
function isImportRecord(item: unknown): item is Partial<LinkItem> & { url: string } {
  return (
    typeof item === "object" && item !== null && typeof (item as { url: unknown }).url === "string"
  );
}

export function parseImport(text: string): LinkItem[] {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(list)) throw new Error("형식이 올바르지 않습니다");
  return list.filter(isImportRecord).map((item) => ({
    id: typeof item.id === "string" ? item.id : createId(),
    url: item.url,
    title: typeof item.title === "string" ? item.title : item.url,
    memo: typeof item.memo === "string" ? item.memo : "",
    tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string") : [],
    image: typeof item.image === "string" ? item.image : undefined,
    favicon: typeof item.favicon === "string" ? item.favicon : undefined,
    siteName: typeof item.siteName === "string" ? item.siteName : undefined,
    pinned: Boolean(item.pinned),
    createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
  }));
}
