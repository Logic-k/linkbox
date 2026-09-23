import { NextResponse } from "next/server";

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024;

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

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }
  return (
    host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")
  );
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
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "http/https 링크만 지원합니다" }, { status: 400 });
  }
  if (isPrivateHost(target.hostname)) {
    return NextResponse.json({ error: "내부 주소는 가져올 수 없습니다" }, { status: 400 });
  }

  try {
    const response = await fetch(target, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; linkbox-bot/1.0; +https://github.com/Logic-k/linkbox)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `페이지를 불러오지 못했습니다 (${response.status})` },
        { status: 502 },
      );
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
