// GitHub Personal Access Token + 비공개 Gist 저장소.
// gist 스코프 토큰이라 앱이 접근하는 건 사용자 Gist뿐이다.
// 동기화 파일은 linkbox.json이라는 파일명을 가진 secret gist — 여러 기기가 같은 파일을 읽고 쓴다

const API = "https://api.github.com";
const GIST_FILE = "linkbox.json";
const GIST_DESC = "linkbox-sync";
const TOKEN_KEY = "linkbox:github-token:v1";

export type RemoteSnapshot = {
  items: { id: string; updatedAt: number; [k: string]: unknown }[];
  deleted?: Record<string, number>;
};

export type RemoteFile = {
  folderId: string | null;
  fileId: string | null;
  snapshot: RemoteSnapshot | null;
};

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// localStorage에 토큰을 보관하는 세션 — OAuth 대신 PAT 붙여넣기 한 번
export class GithubSession {
  private token: string | null = null;

  // 이전에 저장된 토큰을 복원한다 — 유효성은 첫 동기화 호출 때 확인된다
  async restore(): Promise<boolean> {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (!saved) return false;
    this.token = saved;
    return true;
  }

  // 붙여넣은 토큰을 /user로 검증하고 유효하면 저장한다
  async connect(token: string): Promise<boolean> {
    const res = await fetch(`${API}/user`, { headers: authHeaders(token) });
    if (!res.ok) return false;
    this.token = token;
    localStorage.setItem(TOKEN_KEY, token);
    return true;
  }

  async getToken(): Promise<string | null> {
    return this.token;
  }

  async signOut(): Promise<void> {
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
  }
}

type Gist = { id: string; created_at: string; files: Record<string, { filename: string }> };

// linkbox.json을 포함한 gist를 찾는다 — 여러 개면 가장 오래된 것을 고른다(기기 간 수렴)
async function findGist(token: string): Promise<string | null> {
  const res = await fetch(`${API}/gists?per_page=100`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`gist list ${res.status}`);
  const gists = ((await res.json()) as Gist[]).filter((g) => g.files[GIST_FILE]);
  gists.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return gists[0]?.id ?? null;
}

export async function readRemoteFile(token: string): Promise<RemoteFile> {
  const gistId = await findGist(token);
  if (!gistId) return { folderId: null, fileId: null, snapshot: null };
  const res = await fetch(`${API}/gists/${gistId}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`gist get ${res.status}`);
  const gist = (await res.json()) as {
    files?: Record<string, { content?: string; truncated?: boolean; raw_url?: string }>;
  };
  const file = gist.files?.[GIST_FILE];
  if (!file?.content) {
    // 파일이 잘린 경우 raw_url로 본문을 다시 받는다
    if (!file?.raw_url) return { folderId: null, fileId: gistId, snapshot: null };
    const raw = await fetch(file.raw_url, { headers: authHeaders(token) });
    if (!raw.ok) throw new Error(`gist raw ${raw.status}`);
    try {
      return { folderId: null, fileId: gistId, snapshot: (await raw.json()) as RemoteSnapshot };
    } catch {
      return { folderId: null, fileId: gistId, snapshot: null };
    }
  }
  try {
    return {
      folderId: null,
      fileId: gistId,
      snapshot: JSON.parse(file.content) as RemoteSnapshot,
    };
  } catch {
    return { folderId: null, fileId: gistId, snapshot: null };
  }
}

// gist가 없으면 만들고, 있으면 덮어쓴다 — id를 돌려줘 다음 tick이 재사용
export async function writeRemoteFile(
  token: string,
  ids: { folderId: string | null; fileId: string | null },
  snapshot: RemoteSnapshot,
): Promise<{ folderId: string | null; fileId: string }> {
  const payload = {
    files: { [GIST_FILE]: { content: JSON.stringify(snapshot) } },
  };
  if (ids.fileId) {
    const res = await fetch(`${API}/gists/${ids.fileId}`, {
      method: "PATCH",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`gist update ${res.status}`);
    return { folderId: null, fileId: ids.fileId };
  }
  const res = await fetch(`${API}/gists`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ description: GIST_DESC, public: false, ...payload }),
  });
  if (!res.ok) throw new Error(`gist create ${res.status}`);
  const gist = (await res.json()) as { id: string };
  return { folderId: null, fileId: gist.id };
}
