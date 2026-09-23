import { type RemoteSnapshot, readRemoteFile, writeRemoteFile } from "./drive";
import type { LinkItem, Snapshot } from "./store";

export type SyncStatus = "off" | "syncing" | "synced" | "error";

// Drive 파일 전체 스냅샷과 로컬을 id별 최신값으로 병합한다.
// tombstone(deleted)이 항목보다 새로우면 항목은 제거 = 다른 기기의 삭제 전파
export function mergeSnapshot(
  localItems: LinkItem[],
  localDeleted: Record<string, number>,
  remote: RemoteSnapshot | null,
): { items: LinkItem[]; deleted: Record<string, number> } {
  const byId = new Map(localItems.map((i) => [i.id, i]));
  const deleted: Record<string, number> = { ...localDeleted };
  for (const raw of remote?.items ?? []) {
    const item = raw as LinkItem;
    const cur = byId.get(item.id);
    if (!cur || item.updatedAt > cur.updatedAt) byId.set(item.id, item);
  }
  for (const [id, ts] of Object.entries(remote?.deleted ?? {})) {
    if (typeof ts === "number" && ts > (deleted[id] ?? 0)) deleted[id] = ts;
  }
  const items = [...byId.values()].filter((i) => (deleted[i.id] ?? 0) <= i.updatedAt);
  return { items, deleted };
}

// 원격 스냅샷과 병합 결과가 다른지 비교 — 같으면 업로드를 건너뛴다
function snapshotDiffers(
  merged: { items: LinkItem[]; deleted: Record<string, number> },
  remote: RemoteSnapshot | null,
): boolean {
  if (!remote) return merged.items.length > 0 || Object.keys(merged.deleted).length > 0;
  const remoteItems = (remote.items ?? []) as LinkItem[];
  if (remoteItems.length !== merged.items.length) return true;
  const remoteById = new Map(remoteItems.map((i) => [i.id, i.updatedAt]));
  for (const item of merged.items) {
    if (remoteById.get(item.id) !== item.updatedAt) return true;
  }
  const rd = remote.deleted ?? {};
  const ld = merged.deleted;
  if (Object.keys(rd).length !== Object.keys(ld).length) return true;
  return Object.entries(ld).some(([id, ts]) => rd[id] !== ts);
}

const PUSH_DEBOUNCE_MS = 1500;
const PULL_INTERVAL_MS = 60_000;

export type EngineHooks = {
  readEnvelope: () => Snapshot;
  writeMerged: (result: { items: LinkItem[]; deleted: Record<string, number> }) => void;
  setStatus: (status: SyncStatus) => void;
};

// 풀-기반 동기화: Drive 파일을 읽어 병합하고 달라졌으면 통째로 다시 쓴다.
// 파일 단위 덮어쓰기여도 병합이 항목별 LWW라 경쟁 시에도 최신값으로 수렴한다
export class SyncEngine {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private queued = false;
  private fileId: string | null = null;
  private detachFns: (() => void)[] = [];

  constructor(
    private getToken: () => Promise<string | null>,
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
      const token = await this.getToken();
      if (!token) throw new Error("no token");
      const env = this.hooks.readEnvelope();
      const remote = await readRemoteFile(token);
      if (remote) this.fileId = remote.id;
      const merged = mergeSnapshot(env.items, env.deleted, remote?.snapshot ?? null);
      if (snapshotDiffers(merged, remote?.snapshot ?? null)) {
        this.fileId = await writeRemoteFile(token, this.fileId, {
          items: merged.items,
          deleted: merged.deleted,
        });
      }
      this.hooks.writeMerged(merged);
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
