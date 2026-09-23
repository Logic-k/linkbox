"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

function load(): LinkItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLinkItem);
  } catch {
    return [];
  }
}

function persist(items: LinkItem[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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

// localStorage의 최신 값과 메모리 상태를 합친다 — 다른 탭이 쓴 항목과
// 아직 저장되지 못한 항목이 둘 다 살아있도록
function latest(current: LinkItem[]): LinkItem[] {
  const persisted = load();
  if (persisted.length === 0) return current;
  const ids = new Set(persisted.map((i) => i.id));
  return [...persisted, ...current.filter((i) => !ids.has(i.id))];
}

export function useLinks() {
  const [items, setItems] = useState<LinkItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    setItems(load());
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setItems(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback(
    (mutate: (prev: LinkItem[]) => LinkItem[]) => {
      const resolved = mutate(latest(items));
      setStorageError(!persist(resolved));
      setItems(resolved);
    },
    [items],
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
      const base = latest(items);
      const existing = new Set(base.map((i) => i.url));
      const fresh = imported.filter((i) => !existing.has(i.url));
      const next = [...base, ...fresh];
      setStorageError(!persist(next));
      setItems(next);
      return fresh.length;
    },
    [items],
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

export function parseImport(text: string): LinkItem[] {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(list)) throw new Error("형식이 올바르지 않습니다");
  return list.filter(isLinkItem).map((item) => ({
    id: item.id,
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
