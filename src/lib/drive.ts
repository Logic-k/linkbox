// Google Identity Services 토큰 + Drive 파일 접근.
// drive.file 스코프라 앱이 만든 파일/폴더에만 접근하고 사용자의 다른 파일엔 닿지 않는다

const GIS_SRC = "https://accounts.google.com/gsi/client";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "링크박스";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_NAME = "linkbox.json";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

type TokenClient = { requestAccessToken: (overrides?: { prompt?: string }) => void };

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: {
              access_token?: string;
              error?: string;
              expires_in?: number;
            }) => void;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

export type RemoteSnapshot = {
  items: { id: string; updatedAt: number; [k: string]: unknown }[];
  deleted?: Record<string, number>;
};

let gisPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("GIS load failed"));
      document.head.appendChild(script);
    });
  }
  return gisPromise;
}

function requestAccessToken(clientId: string, prompt: string): Promise<string | null> {
  return loadGis().then(
    () =>
      new Promise((resolve) => {
        const client = window.google?.accounts?.oauth2?.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: (resp) => resolve(resp.access_token ?? null),
        });
        if (!client) return resolve(null);
        client.requestAccessToken({ prompt });
      }),
  );
}

export class DriveSession {
  private token: string | null = null;
  private expAt = 0;

  constructor(private clientId: string) {}

  get connected(): boolean {
    return this.token !== null;
  }

  async signIn(): Promise<boolean> {
    const token = await requestAccessToken(this.clientId, "consent");
    return this.set(token);
  }

  // 이전에 동의한 세션을 팝업 없이 복원한다 — 실패하면 연결 안 된 것으로 간주
  async restore(): Promise<boolean> {
    const token = await requestAccessToken(this.clientId, "");
    return this.set(token);
  }

  private async set(token: string | null): Promise<boolean> {
    this.token = token;
    this.expAt = token ? Date.now() + 3500 * 1000 : 0;
    return token !== null;
  }

  // 만료가 가까우면 조용히 재발급하고, 그래도 없으면 null
  async getToken(): Promise<string | null> {
    if (this.token && Date.now() < this.expAt - 60_000) return this.token;
    return (await this.restore()) ? this.token : null;
  }

  async signOut(): Promise<void> {
    const token = this.token;
    this.token = null;
    this.expAt = 0;
    if (token) {
      try {
        await loadGis();
        window.google?.accounts?.oauth2?.revoke(token);
      } catch {
        // 해제 실패는 무시 — 로컬 토큰만 버려도 무방
      }
    }
  }
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export type RemoteFile = {
  folderId: string | null;
  fileId: string | null;
  snapshot: RemoteSnapshot | null;
};

async function driveQuery(token: string, q: string): Promise<{ id: string }[]> {
  const res = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=10&orderBy=createdTime`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error(`drive list ${res.status}`);
  const { files } = (await res.json()) as { files?: { id: string }[] };
  return files ?? [];
}

// 드라이브의 "링크박스" 폴더에서 linkbox.json을 찾아 읽는다 — 없으면 해당 필드가 null
export async function readRemoteFile(token: string): Promise<RemoteFile> {
  const folderId =
    (
      await driveQuery(
        token,
        `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`,
      )
    )[0]?.id ?? null;
  if (!folderId) return { folderId: null, fileId: null, snapshot: null };
  const fileId =
    (
      await driveQuery(token, `name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`)
    )[0]?.id ?? null;
  if (!fileId) return { folderId, fileId: null, snapshot: null };
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`drive get ${res.status}`);
  try {
    return { folderId, fileId, snapshot: (await res.json()) as RemoteSnapshot };
  } catch {
    return { folderId, fileId, snapshot: null };
  }
}

// 필요하면 "링크박스" 폴더와 파일을 만들고 내용을 쓴다 — id를 돌려줘 다음 tick이 재사용
export async function writeRemoteFile(
  token: string,
  ids: { folderId: string | null; fileId: string | null },
  snapshot: RemoteSnapshot,
): Promise<{ folderId: string; fileId: string }> {
  const body = JSON.stringify(snapshot);
  let { folderId, fileId } = ids;
  if (!folderId) {
    const res = await fetch(`${DRIVE_API}/files`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    if (!res.ok) throw new Error(`drive mkdir ${res.status}`);
    folderId = ((await res.json()) as { id: string }).id;
  }
  if (fileId) {
    const res = await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) throw new Error(`drive update ${res.status}`);
    return { folderId, fileId };
  }
  const meta = JSON.stringify({ name: FILE_NAME, parents: [folderId] });
  const form = new FormData();
  form.append("metadata", new Blob([meta], { type: "application/json" }));
  form.append("file", new Blob([body], { type: "application/json" }));
  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  if (!res.ok) throw new Error(`drive create ${res.status}`);
  fileId = ((await res.json()) as { id: string }).id;
  return { folderId, fileId };
}
