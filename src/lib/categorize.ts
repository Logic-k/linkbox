// 링크를 규칙으로 자동 분류한다 — 도메인 매핑 우선, 제목 키워드로 보강.
// 외부 AI API 없이 동작해야 하므로 결정적 휴리스틱만 쓴다.

const DOMAIN_TAGS: [RegExp, string[]][] = [
  [/github\.com|gitlab\.com|bitbucket\.org/i, ["개발", "코드"]],
  [/youtube\.com|youtu\.be|twitch\.tv/i, ["영상"]],
  [/threads\.net|x\.com|twitter\.com|instagram\.com|facebook\.com|tiktok\.com/i, ["SNS"]],
  [/medium\.com|velog\.io|tistory\.com|brunch\.co\.kr|dev\.to|substack\.com/i, ["블로그"]],
  [/notion\.so|docs\.google\.com|drive\.google\.com/i, ["문서"]],
  [/arxiv\.org|paperswithcode\.com|huggingface\.co/i, ["AI", "연구"]],
  [/news\.|\.news|yna\.co\.kr|hani\.co\.kr|chosun\.com|joongang\.co\.kr|bbc\.|cnn\.com|reuters\.com|theverge\.com|techcrunch\.com/i, ["뉴스"]],
  [/naver\.com|daum\.net|nate\.com/i, ["포털"]],
  [/amazon\.|coupang\.com|11st\.co\.kr|gmarket\.co\.kr/i, ["쇼핑"]],
  [/stackoverflow\.com/i, ["개발", "Q&A"]],
  [/wikipedia\.org/i, ["지식"]],
  [/reddit\.com|dcinside\.com|theqoo\.net|fmkorea\.com/i, ["커뮤니티"]],
];

const TITLE_TAGS: [RegExp, string][] = [
  [/\bai\b|gpt|llm|claude|openai|gemini|인공지능|머신러닝|딥러닝|프롬프트|에이전트|copilot/i, "AI"],
  [/python|javascript|typescript|react|next\.?js|node\.?js|rust|golang|\bapi\b|sdk|프레임워크|코드|개발|programming|tutorial|튜토리얼/i, "개발"],
  [/css|디자인|figma|ui\/ux|\bux\b|\bui\b|폰트|레이아웃/i, "디자인"],
  [/영상|유튜브|video|vlog/i, "영상"],
  [/뉴스|기사|속보|breaking/i, "뉴스"],
  [/채용|커리어|career|이력서|resume|면접|interview/i, "커리어"],
  [/투자|주식|코인|비트코인|재테크|stock|crypto|경제/i, "금융"],
  [/게임|game|스팀|steam/i, "게임"],
  [/맛집|레시피|recipe|요리/i, "음식"],
  [/여행|travel|항공|호텔/i, "여행"],
];

// 최대 3개의 태그를 제안한다 — 도메인 태그가 먼저, 제목 키워드는 중복 없이 뒤에
export function suggestTags(url: string, title: string): string[] {
  const out: string[] = [];
  const push = (tag: string) => {
    if (!out.includes(tag)) out.push(tag);
  };
  try {
    const { hostname } = new URL(url);
    for (const [pattern, tags] of DOMAIN_TAGS) {
      if (pattern.test(hostname)) {
        for (const t of tags) push(t);
        break;
      }
    }
  } catch {
    // url이 이미 normalize된 상태로 오지만, 방어적으로 무시
  }
  for (const [pattern, tag] of TITLE_TAGS) {
    if (out.length >= 3) break;
    if (pattern.test(title)) push(tag);
  }
  return out.slice(0, 3);
}
