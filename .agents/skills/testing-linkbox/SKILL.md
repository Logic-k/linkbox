---
name: testing-linkbox
description: How to run and E2E-test the linkbox Next.js app — dev-server quirks, deterministic URLs for the metadata-preview success/error paths, localStorage state, and GTK file-dialog import.
---

# Testing linkbox (개인 링크 보관함)

Next.js 16 + React 19 app in `~/repos/linkbox` (pnpm via nvm). Personal link scrapbox: URL → `/api/metadata` preview → card in localStorage.

## Dev server

- `source ~/.nvm/nvm.sh` first (Node/pnpm come from nvm in non-interactive shells).
- `pnpm dev --port 3000`. **Next.js 16 refuses a second dev server for the same project dir** — if one is already running it exits and prints the existing server's URL/PID (e.g. `http://localhost:3100`, PID in `.next/dev/`). Just use that URL instead of starting your own. Check `.next/dev/logs/` or the startup output for the actual port.
- Turbopack hot-reloads on file save — mid-run commits take effect on next page load; re-verify core flow after tree changes.

## Deterministic URLs for metadata preview tests

`GET /api/metadata?url=<encoded>` — SSRF-guarded (blocks localhost/private IPs/non-http), 8s timeout, 512KB cap.

- **Success path**: `https://github.com/<org>/<repo>` reliably returns og:title/image/favicon (`github.com/facebook/react` redirects to `react/react` — both fine).
- **Error path**: `https://example.com/nonexistent-page-<random>` → upstream 404 → API 502 `{"error":"페이지를 불러오지 못했습니다 (404)"}` → red preview "… — 그래도 저장할 수 있습니다", save still allowed (title falls back to hostname).
- `threads.com` may 429 or may return 200 — do NOT rely on it for the failure path.
- `http://127.0.0.1:<port>` → 400 `내부 주소는 가져올 수 없습니다` (SSRF guard check).

## App state

- localStorage key: `linkbox:items:v1` (JSON array of LinkItem). Fresh origin ⇒ empty state "저장된 링크가 없습니다". Header shows count "N개".
- Debounce: metadata fetch fires ~500ms after URL typing stops; wait ~3s for preview.
- Pin moves card to top (sorted: pinned first, then createdAt desc). Tag chips appear only when ≥1 card has tags; clicking chip toggles filter, "전체" clears.
- Memo edit: click memo text → textarea; Enter or blur commits, Escape cancels.
- Delete has NO confirm dialog — click trash, card gone immediately.

## Export / Import via computer-use

- Export button (header, download icon) → `linkbox-YYYY-MM-DD.json` lands in `~/Downloads` instantly (Chrome for Testing auto-downloads, no dialog). Verify with shell `ls`.
- Import button (upload icon) → GTK file dialog. `Ctrl+L` then type the absolute path, `Enter` → JS `alert("N개 링크를 가져왔습니다")` (dismiss with OK/Enter). Import dedups by URL — re-importing same file reports "0개".

## Share-target prefill

`/?url=<enc>` or `/?text=<text with URL>` or `/?title=<text>` → first `https?://\S+` match prefills the URL field and auto-fetches preview. `manifest.webmanifest` declares `share_target` GET `/`.

## Input quirks

- Type memo/tags in ENGLISH when automating — IME input can drop characters; app itself handles UTF-8 fine.
- Chrome window resize for mobile test: `wmctrl -r "<title>" -e 0,x,y,420,700` (min-width ~500px applies; layout stacks under 540px breakpoint).

## Devin Secrets Needed

None — app has no login, DB, or external service keys.
