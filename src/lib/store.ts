"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyncEngine, SyncStatus } from "./sync";

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
  updatedAt: number;
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

export type Snapshot = {
  rev: number;
  items: LinkItem[];
  // 서버에 아직 밀어내지 않은 로컬 변경 id와 삭제 tombstone(id → 삭제 시각 ms)
  dirty: string[];
  deleted: Record<string, number>;
};

function loadSnapshot(): Snapshot {
  const empty: Snapshot = { rev: 0, items: [], dirty: [], deleted: {} };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    // 초기 포맷(배열)과 {rev, items, dirty, deleted} 스냅샷 포맷을 모두 읽는다
    const list = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(list)) return empty;
    const items = list
      .filter(isLinkItem)
      .map((item) => ({ ...item, updatedAt: item.updatedAt ?? item.createdAt }));
    return {
      rev: typeof parsed?.rev === "number" ? parsed.rev : 0,
      items,
      // 레거시 포맷(dirty 필드 없음)은 전체를 미전송으로 간주해 첫 로그인 때 모두 올린다
      dirty: Array.isArray(parsed?.dirty)
        ? parsed.dirty.filter((d: unknown) => typeof d === "string")
        : items.map((i) => i.id),
      deleted:
        parsed?.deleted && typeof parsed.deleted === "object" && !Array.isArray(parsed.deleted)
          ? (parsed.deleted as Record<string, number>)
          : {},
    };
  } catch {
    return empty;
  }
}

function persist(snapshot: Snapshot): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
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

type Mutation = { items: LinkItem[]; touched?: string[]; removed?: string[] };

export type WriteMergedResult = {
  items: LinkItem[];
  // 원격에서 관측한 tombstone(id → 삭제 시각 ms)
  tombstones: Record<string, number>;
  // 서버에 실제로 반영된 push(id → 밀어낸 시각 ms) — 그보다 새로운 로컬 버전은 유지
  clearedDirty: Record<string, number>;
  clearedDeleted: Record<string, number>;
};

export function useLinks() {
  const [items, setItems] = useState<LinkItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("off");
  // 이 탭이 마지막으로 기록/관측한 스냅샷 리비전 — 저장소의 rev가 더 크면
  // 다른 탭이 쓴 뒤이므로 그쪽을 authoritative로 채택한다(삭제도 되살아나지 않음)
  const revRef = useRef(0);
  const engineRef = useRef<SyncEngine | null>(null);
  // 엔진이 최신 items를 읽되 렌더 의존성으로 엔진이 재생성되지 않도록 ref 유지
  const itemsRef = useRef<LinkItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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

  const writeSnapshot = useCallback((snapshot: Snapshot) => {
    if (persist(snapshot)) {
      revRef.current = snapshot.rev;
      setStorageError(false);
    } else {
      // 쓰기 실패 시 rev를 올리지 않음 — 다음 mutation이 메모리 상태를 이어받아 재시도
      setStorageError(true);
    }
    setItems(snapshot.items);
  }, []);

  const mutateAndPersist = useCallback(
    (mutate: (base: LinkItem[]) => Mutation) => {
      const snap = loadSnapshot();
      const base = snap.rev > revRef.current ? snap.items : items;
      const out = mutate(base);
      const liveIds = new Set(out.items.map((i) => i.id));
      const dirty = new Set(snap.dirty);
      const deleted = { ...snap.deleted };
      for (const id of out.touched ?? []) {
        if (liveIds.has(id)) {
          dirty.add(id);
          delete deleted[id];
        }
      }
      for (const id of out.removed ?? []) {
        dirty.delete(id);
        deleted[id] = Date.now();
      }
      // items에 없는 id는 밀어낼 본문이 없으므로 dirty에서 정리 (tombstone 경로만 남음)
      for (const id of dirty) {
        if (!liveIds.has(id)) dirty.delete(id);
      }
      writeSnapshot({ rev: snap.rev + 1, items: out.items, dirty: [...dirty], deleted });
      engineRef.current?.queue();
      return out.items;
    },
    [items, writeSnapshot],
  );

  const update = useCallback(
    (mutate: (prev: LinkItem[]) => LinkItem[], touched?: (next: LinkItem[]) => string[]) => {
      mutateAndPersist((prev) => {
        const next = mutate(prev);
        return { items: next, touched: touched ? touched(next) : undefined };
      });
    },
    [mutateAndPersist],
  );

  const add = useCallback(
    (draft: LinkDraft) => {
      const now = Date.now();
      const item: LinkItem = {
        id: createId(),
        pinned: false,
        createdAt: now,
        updatedAt: now,
        ...draft,
      };
      update(
        (prev) => [item, ...prev],
        () => [item.id],
      );
      return item;
    },
    [update],
  );

  const remove = useCallback(
    (id: string) => {
      mutateAndPersist((prev) => ({
        items: prev.filter((item) => item.id !== id),
        removed: [id],
      }));
    },
    [mutateAndPersist],
  );

  const togglePin = useCallback(
    (id: string) => {
      update(
        (prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, pinned: !item.pinned, updatedAt: Date.now() } : item,
          ),
        () => [id],
      );
    },
    [update],
  );

  const editMemo = useCallback(
    (id: string, memo: string) => {
      update(
        (prev) =>
          prev.map((item) => (item.id === id ? { ...item, memo, updatedAt: Date.now() } : item)),
        () => [id],
      );
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
        return { items: [...base, ...fresh], touched: fresh.map((i) => i.id) };
      });
      return count;
    },
    [mutateAndPersist],
  );

  // SyncEngine이 붙는 지점. pull 병합 결과를 쓸 때는 그 사이 생긴 로컬 변경을
  // 잃지 않도록 최신 스냅샷과 id별 updatedAt 비교로 다시 합치고, 이번 tick에서
  // 성공적으로 push된 dirty/tombstone만 장부에서 지운다
  const writeMerged = useCallback(
    (result: WriteMergedResult) => {
      const snap = loadSnapshot();
      const deleted = { ...snap.deleted };
      for (const [id, ts] of Object.entries(result.tombstones)) {
        if (ts > (deleted[id] ?? 0)) deleted[id] = ts;
      }
      for (const [id, pushedTs] of Object.entries(result.clearedDeleted)) {
        if ((deleted[id] ?? 0) <= pushedTs) delete deleted[id];
      }
      // tombstone이 항목보다 새로우면 제거 — 다른 기기의 삭제가 여기서 로컬에 전파된다
      const merged = mergeByUpdatedAt(result.items, snap.items).filter(
        (i) => (deleted[i.id] ?? 0) <= i.updatedAt,
      );
      const byId = new Map(merged.map((i) => [i.id, i]));
      const dirty = snap.dirty.filter((id) => {
        const local = byId.get(id);
        if (!local) return false;
        const pushedTs = result.clearedDirty[id];
        return pushedTs === undefined || local.updatedAt > pushedTs;
      });
      writeSnapshot({ rev: snap.rev + 1, items: merged, dirty, deleted });
    },
    [writeSnapshot],
  );

  const engineHooks = useMemo(
    () => ({
      readEnvelope: (): Snapshot => {
        const snap = loadSnapshot();
        if (snap.rev > revRef.current) return snap;
        return {
          rev: revRef.current,
          items: itemsRef.current,
          dirty: snap.dirty,
          deleted: snap.deleted,
        };
      },
      writeMerged,
      setStatus: setSyncStatus,
    }),
    [writeMerged],
  );

  const attachEngine = useCallback((engine: SyncEngine | null) => {
    engineRef.current?.detach();
    engineRef.current = engine;
    if (!engine) setSyncStatus("off");
  }, []);

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
    syncStatus,
    engineHooks,
    attachEngine,
    add,
    remove,
    togglePin,
    editMemo,
    mergeImported,
  };
}

// id별 updatedAt이 큰 쪽을 채택하는 단순 병합 — pull 결과와 그 사이 생긴
// 로컬 변경을 합칠 때 사용한다
function mergeByUpdatedAt(a: LinkItem[], b: LinkItem[]): LinkItem[] {
  const byId = new Map(a.map((i) => [i.id, i]));
  for (const item of b) {
    const cur = byId.get(item.id);
    if (!cur || item.updatedAt > cur.updatedAt) byId.set(item.id, item);
  }
  return [...byId.values()];
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
  const now = Date.now();
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
    createdAt: typeof item.createdAt === "number" ? item.createdAt : now,
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : now,
  }));
}
