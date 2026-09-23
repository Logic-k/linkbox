import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinkItem, Snapshot, WriteMergedResult } from "./store";

export type SyncStatus = "off" | "syncing" | "synced" | "error";

type RemoteRow = {
  id: string;
  url: string;
  title: string;
  memo: string;
  tags: string[];
  image?: string;
  favicon?: string;
  site_name?: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

function toRow(userId: string, item: LinkItem, deletedAt: number | null) {
  return {
    id: item.id,
    user_id: userId,
    url: item.url,
    title: item.title,
    memo: item.memo,
    tags: item.tags,
    image: item.image ?? null,
    favicon: item.favicon ?? null,
    site_name: item.siteName ?? null,
    pinned: item.pinned,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    deleted_at: deletedAt,
  };
}

function tombstoneRow(userId: string, id: string, ts: number) {
  return {
    id,
    user_id: userId,
    url: "",
    title: "",
    memo: "",
    tags: [] as string[],
    image: null,
    favicon: null,
    site_name: null,
    pinned: false,
    created_at: 0,
    updated_at: ts,
    deleted_at: ts,
  };
}

function toItem(row: RemoteRow): LinkItem {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    memo: row.memo,
    tags: row.tags,
    image: row.image ?? undefined,
    favicon: row.favicon ?? undefined,
    siteName: row.site_name ?? undefined,
    pinned: row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// last-write-wins 병합: 같은 id는 updatedAt이 큰 쪽을 채택하고,
// 원격 tombstone이 로컬보다 새로우면 로컬에서도 제거한다
function mergeRemote(local: LinkItem[], remote: RemoteRow[]): LinkItem[] {
  const byId = new Map(local.map((i) => [i.id, i]));
  for (const row of remote) {
    const l = byId.get(row.id);
    const remoteTs = Math.max(row.updated_at, row.deleted_at ?? 0);
    if (!l) {
      if (row.deleted_at === null) byId.set(row.id, toItem(row));
      continue;
    }
    if (remoteTs > l.updatedAt) {
      if (row.deleted_at === null) byId.set(row.id, toItem(row));
      else byId.delete(row.id);
    }
  }
  return [...byId.values()];
}

const PUSH_DEBOUNCE_MS = 1500;
const PULL_INTERVAL_MS = 60_000;

export type EngineHooks = {
  readEnvelope: () => Snapshot;
  writeMerged: (result: WriteMergedResult) => void;
  setStatus: (status: SyncStatus) => void;
};

// 풀-기반 동기화: 변경·포커스·주기 타이머마다 전체 pull → LWW 병합 → dirty+tombstone push.
// 항목 수가 적은 개인 앱이라 전체 조회로 충분하며, 오프라인/재시도에도 멱등이다.
export class SyncEngine {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private queued = false;
  private detachFns: (() => void)[] = [];

  constructor(
    private client: SupabaseClient,
    private userId: string,
    private hooks: EngineHooks,
  ) {}

  start() {
    const onFocus = () => this.kick();
    const onOnline = () => this.kick();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    this.detachFns.push(() => window.removeEventListener("focus", onFocus));
    this.detachFns.push(() => window.removeEventListener("online", onOnline));
    this.interval = setInterval(() => this.kick(), PULL_INTERVAL_MS);
    void this.tick();
  }

  queue() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), PUSH_DEBOUNCE_MS);
  }

  kick() {
    void this.tick();
  }

  detach() {
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
  }

  private async tick() {
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    this.hooks.setStatus("syncing");
    try {
      const env = this.hooks.readEnvelope();
      const { data, error } = await this.client
        .from("links")
        .select(
          "id,url,title,memo,tags,image,favicon,site_name,pinned,created_at,updated_at,deleted_at",
        )
        .eq("user_id", this.userId);
      if (error) throw error;

      const remote = (data ?? []) as RemoteRow[];
      const remoteById = new Map(remote.map((r) => [r.id, r]));
      const merged = mergeRemote(env.items, remote);
      const mergedById = new Map(merged.map((i) => [i.id, i]));

      // push 대상: 아직 로컬이 이기는 dirty 행 + 원격보다 새로운 tombstone
      const pushItems = env.dirty.filter((id) => {
        const local = mergedById.get(id);
        if (!local) return false;
        const row = remoteById.get(id);
        if (!row) return true;
        return local.updatedAt > Math.max(row.updated_at, row.deleted_at ?? 0);
      });
      const pushDeleted = Object.entries(env.deleted).filter(([id, ts]) => {
        const row = remoteById.get(id);
        return !row || ts > (row.deleted_at ?? row.updated_at);
      });

      const rows = [
        ...pushItems.map((id) => toRow(this.userId, mergedById.get(id) as LinkItem, null)),
        ...pushDeleted.map(([id, ts]) => tombstoneRow(this.userId, id, ts)),
      ];
      if (rows.length > 0) {
        const { error: upErr } = await this.client.from("links").upsert(rows);
        if (upErr) throw upErr;
      }

      this.hooks.writeMerged({
        items: merged,
        clearedDirty: new Set(pushItems),
        clearedDeleted: new Set(pushDeleted.map(([id]) => id)),
      });
      this.hooks.setStatus("synced");
    } catch {
      this.hooks.setStatus("error");
    } finally {
      this.running = false;
      if (this.queued) {
        this.queued = false;
        void this.tick();
      }
    }
  }
}
