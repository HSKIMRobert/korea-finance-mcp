/**
 * search_company — 회사명 → DART corp_code 검색 (v1.4, 19번째 도구)
 *
 * @see wiki/korea-finance-mcp/work-orders.md WO-124
 *
 * 배경: KNOWN_COMPANIES 30개 밖의 회사(예: 삼양식품)는 corp_code(8자리)를
 *   사용자가 zip을 수동 다운로드해 찾아야 했음 — 에이전트 체인이 끊기는 지점.
 *   본 도구가 corpCode.xml 전체(~10만 기업, 서버 24h 캐시)에서 부분일치 검색.
 *
 * 양보 불가:
 * - DART 원본 매핑 그대로 — 유사 후보 임의 선택 ❌ (복수 후보면 전부 반환, 선택은 호출자)
 * - 검색 결과 0건 → buildNoData (추측 금지)
 * - 종목 분석·추천 키워드 0건 (조회 전용)
 */

import { z } from "zod";
import { buildResponse, buildNoData } from "../lib/response.js";
import { searchCorpByName, DART_ENDPOINTS, type CorpEntry } from "../lib/dart.js";

export const SearchCompanyInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(2, "query는 회사명 부분일치 검색어 (2자 이상, 예: 삼양식품)"),
  listed_only: z
    .boolean()
    .optional()
    .default(true)
    .describe("true(기본): 상장사만 / false: 비상장 포함 전체"),
});

export type SearchCompanyInput = z.infer<typeof SearchCompanyInputSchema>;

export const searchCompanyTool = {
  name: "search_company",
  title: "Korea DART Company Code Search",
  description: [
    "회사명 부분일치 → DART corp_code(8자리) 검색.",
    "입력: query (회사명 일부, 2자+), listed_only (default true)",
    "출력: 상위 10건 {corp_code, corp_name, stock_code} — 상장 우선·정확명 우선",
    "용도: get_disclosure·get_financials·get_major_holdings 등의 corp_code 입력 해결.",
    "데이터: DART corpCode 전체 디렉터리 (~10만 기업, 서버 24h 캐시)",
  ].join("\n"),
  inputSchema: SearchCompanyInputSchema,
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
} as const;

export async function executeSearchCompany(input: SearchCompanyInput) {
  const lastUpdatedAt = new Date().toISOString();
  const matches: CorpEntry[] = await searchCorpByName(input.query, {
    listed_only: input.listed_only ?? true,
    limit: 10,
  });

  if (matches.length === 0) {
    return buildNoData({
      source: "DART OpenAPI corpCode 디렉터리",
      source_url: DART_ENDPOINTS.corp_code_xml,
      last_updated_at: lastUpdatedAt,
      warnings: [
        `'${input.query}' 부분일치 회사 없음` +
          ((input.listed_only ?? true) ? " (상장사 한정 — listed_only=false로 비상장 포함 재검색 가능)" : ""),
      ],
    });
  }

  return buildResponse({
    source: "DART OpenAPI corpCode 디렉터리",
    source_url: DART_ENDPOINTS.corp_code_xml,
    last_updated_at: lastUpdatedAt,
    data: {
      meta: {
        query: input.query,
        listed_only: input.listed_only ?? true,
        match_count: matches.length,
        usage_note: "corp_code를 get_disclosure 등의 corp_code 입력으로 사용",
      },
      matches,
    },
  });
}
