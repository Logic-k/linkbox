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

function load(): LinkItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LinkItem =>
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "string" &&
        typeof item.url === "string",
    );
  } catch {
    return [];
  }
}

function persist(items: LinkItem[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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

  useEffect(() => {
    setItems(load());
    setHydrated(true);
  }, []);

  const update = useCallback((next: LinkItem[] | ((prev: LinkItem[]) => LinkItem[])) => {
    setItems((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      persist(resolved);
      return resolved;
    });
  }, []);

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

  const replaceAll = useCallback(
    (next: LinkItem[]) => {
      update(next);
    },
    [update],
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

  return { items: sorted, hydrated, allTags, add, remove, togglePin, editMemo, replaceAll };
}

export function exportJson(items: LinkItem[]): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items }, null, 2);
}

export function parseImport(text: string): LinkItem[] {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(list)) throw new Error("형식이 올바르지 않습니다");
  return list
    .filter(
      (item): item is LinkItem =>
        typeof item === "object" && item !== null && typeof item.url === "string",
    )
    .map((item) => ({
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
