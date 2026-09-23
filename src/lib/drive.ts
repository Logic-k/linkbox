// Google Identity Services 토큰 + Drive appDataFolder 파일 접근.
// 앱 전용 숨김 폴더라 사용자의 다른 드라이브 파일엔 접근하지 못한다(drive.appdata 스코프)

const GIS_SRC = "https://accounts.google.com/gsi/client";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
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

export type RemoteFile = { id: string; snapshot: RemoteSnapshot | null };

// appDataFolder에서 linkbox.json을 찾아 내용을 읽는다. 없으면 null
export async function readRemoteFile(token: string): Promise<RemoteFile | null> {
  const list = await fetch(
    `${DRIVE_API}/files?spaces=appDataFolder&q=name='${FILE_NAME}'&fields=files(id)`,
    { headers: authHeaders(token) },
  );
  if (!list.ok) throw new Error(`drive list ${list.status}`);
  const { files } = (await list.json()) as { files?: { id: string }[] };
  const file = files?.[0];
  if (!file) return null;
  const res = await fetch(`${DRIVE_API}/files/${file.id}?alt=media`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`drive get ${res.status}`);
  try {
    const body = (await res.json()) as RemoteSnapshot;
    return { id: file.id, snapshot: body };
  } catch {
    return { id: file.id, snapshot: null };
  }
}

export async function writeRemoteFile(
  token: string,
  fileId: string | null,
  snapshot: RemoteSnapshot,
): Promise<string> {
  const body = JSON.stringify(snapshot);
  if (fileId) {
    const res = await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) throw new Error(`drive update ${res.status}`);
    return fileId;
  }
  const meta = JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] });
  const form = new FormData();
  form.append("metadata", new Blob([meta], { type: "application/json" }));
  form.append("file", new Blob([body], { type: "application/json" }));
  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  if (!res.ok) throw new Error(`drive create ${res.status}`);
  const created = (await res.json()) as { id: string };
  return created.id;
}
