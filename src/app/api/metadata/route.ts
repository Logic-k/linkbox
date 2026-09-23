import { promises as dns } from "node:dns";
import { NextResponse } from "next/server";

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|[^\\s>]+)`, "i"));
  if (!match) return undefined;
  return decodeEntities(match[2] ?? match[3] ?? match[1] ?? "");
}

function metaContent(html: string, keys: string[]): string | undefined {
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (keys.includes(key)) {
      const content = attr(tag, "content");
      if (content) return content;
    }
  }
  return undefined;
}

function pageTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1].trim()) : undefined;
}

function favicon(html: string, base: URL): string | undefined {
  for (const tag of html.match(/<link\s[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    if (rel.includes("icon")) {
      const href = attr(tag, "href");
      if (href) return resolveUrl(href, base);
    }
  }
  return `${base.origin}/favicon.ico`;
}

function resolveUrl(href: string, base: URL): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

// WHATWG URL 파서가 비표준 IPv4(0x7f000001, 2130706433 등)를 표준 표기로 정규화한 뒤 호출됨
function isPrivateHost(hostname: string): boolean {
  let host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.startsWith("::ffff:")) host = host.slice(7); // IPv4-mapped IPv6
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (!host.includes(":")) return false;
  const first = host.split(":")[0];
  return host === "::1" || host === "::" || /^fe[89ab]/.test(first) || /^f[cd]/.test(first);
}

// DNS 별칭이 내부 주소로 해석되는 경우 차단 (조회 시점 이후의 재바인딩까지는 막지 못함)
async function resolvesToPrivate(hostname: string): Promise<boolean> {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0) return true;
    return records.some((record) => isPrivateHost(record.address));
  } catch {
    return true; // 조회 실패 시 요청도 실패하므로 차단 쪽이 안전
  }
}

const PRIVATE_HOST_ERROR = "내부 주소는 가져올 수 없습니다";

async function validateTarget(target: URL): Promise<NextResponse | null> {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "http/https 링크만 지원합니다" }, { status: 400 });
  }
  if (isPrivateHost(target.hostname) || (await resolvesToPrivate(target.hostname))) {
    return NextResponse.json({ error: PRIVATE_HOST_ERROR }, { status: 400 });
  }
  return null;
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "url 파라미터가 필요합니다" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "올바른 URL이 아닙니다" }, { status: 400 });
  }

  const initialError = await validateTarget(target);
  if (initialError) return initialError;

  try {
    // 리다이렉트를 수동으로 따라가며 매 홉의 대상을 다시 검증한다
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(target, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "manual",
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; linkbox-bot/1.0; +https://github.com/Logic-k/linkbox)",
          accept: "text/html,application/xhtml+xml",
        },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        const next = resolveUrl(location, target);
        if (!next) {
          return NextResponse.json({ error: "잘못된 리다이렉트입니다" }, { status: 502 });
        }
        const nextUrl = new URL(next);
        const hopError = await validateTarget(nextUrl);
        if (hopError) return hopError;
        target = nextUrl;
        continue;
      }
      response = res;
      break;
    }
    if (!response) {
      return NextResponse.json({ error: "리다이렉트가 너무 많습니다" }, { status: 502 });
    }
    if (!response.ok) {
      return NextResponse.json(
        { error: `페이지를 불러오지 못했습니다 (${response.status})` },
        { status: 502 },
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("html")) {
      return NextResponse.json({ error: "웹페이지가 아닌 링크입니다" }, { status: 502 });
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return NextResponse.json({ error: "본문을 읽을 수 없습니다" }, { status: 502 });
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      received += value.byteLength;
      if (received >= MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const html = new TextDecoder().decode(
      chunks.length === 1 ? chunks[0] : concat(chunks, received),
    );

    const finalUrl = new URL(response.url || target.toString());
    const title =
      metaContent(html, ["og:title", "twitter:title"]) ?? pageTitle(html) ?? finalUrl.hostname;
    const rawImage = metaContent(html, ["og:image", "twitter:image"]);

    return NextResponse.json({
      url: finalUrl.toString(),
      title,
      description: metaContent(html, ["description", "og:description", "twitter:description"]),
      image: rawImage ? resolveUrl(rawImage, finalUrl) : undefined,
      favicon: favicon(html, finalUrl),
      siteName: metaContent(html, ["og:site_name", "application-name"]) ?? finalUrl.hostname,
    });
  } catch {
    return NextResponse.json({ error: "페이지를 불러오지 못했습니다" }, { status: 502 });
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
