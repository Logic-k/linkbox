# 링크박스 (linkbox)

스레드(Threads) 같은 SNS를 보다가 "나중에 보자", "이거 써먹어야지" 하는 링크를 **한줄 메모와 함께** 저장하는 개인용 링크 보관함입니다.

## 왜 만들었나 (시중 앱 조사 요약)

| 앱 | 특징 | 이 용도에 대한 평가 |
|---|---|---|
| ~~Pocket~~ | 대표 read-it-later | **2025년 7월 서비스 종료** |
| Raindrop.io | 비주얼 북마크, 컬렉션/태그 | 기능은 충분하지만 컬렉션 관리가 무겁고, "왜 저장했는지" 메모가 부각되지 않음 |
| Instapaper / Matter / Tuck | 읽기 경험 중심 (리더뷰, TTS) | 긴 글 읽기용 — 링크+메모 스크랩 용도엔 과함 |
| Karakeep / Markwise | AI 자동 태그·검색 | AI 기능이 무겁고 계정/호스팅 필요 |
| Marky | 크롬 확장, 저장 이유 메모 | 방향이 같지만 크롬 전용·확장 설치 필요 |
| Notion 웹 클리퍼 | Notion으로 저장 | 수동 입력이 많고 느림 |
| 스레드 자체 저장 | 앱 내 저장 | 저장하면 다시 안 보게 됨 — 이 프로젝트의 출발점 |

결론: "링크 + 왜 저장했는지 한줄 메모"만 빠르게 남기는 최소 기능 앱은 없어서 직접 만들었습니다.

## 기능

- **URL 붙여넣기 → 제목/파비콘/OG 이미지 자동 수집** (`/api/metadata` 가 서버에서 가져옴)
- **한줄 메모** — 저장할 때 "이 링크가 뭔지" 적고, 카드에서 클릭 한 번으로 수정
- **태그**(쉼표 구분) + 태그 칩 필터 + 제목/메모/도메인 검색
- **핀 고정**으로 중요한 링크 상단 유지
- **PWA + 공유 타겟**: 폰에서 홈 화면에 추가하면 Threads → 공유 → 링크박스로 바로 저장
- **JSON 내보내기/가져오기**로 백업·기기 이동
- 로그인 없음 — `localStorage` 저장 (DB 불필요, 어디든 배포 가능)

## 실행

```bash
source ~/.nvm/nvm.sh   # Node 24
npm install
npm run dev            # http://localhost:3000
```

검증: `npm run lint` (Biome), `npm run typecheck`, `npm run build`

## 배포

Vercel에 그대로 올리면 됩니다 (Next.js + API route 1개, 외부 서비스 없음). 배포 후 폰 브라우저에서 "홈 화면에 추가"하면 공유 타겟으로 등록됩니다.

## 스택

Next.js (App Router) · React 19 · TypeScript · Biome · lucide-react · CSS variables
