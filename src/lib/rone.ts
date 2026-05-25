/**
 * 한국부동산원 R-ONE API 클라이언트 (주택가격지수 + 전세가율)
 *
 * @see wiki/korea-finance-mcp/realestate-api-research.md §2
 * @see wiki/korea-finance-mcp/api-key-issuance-guide-realestate.md Step 4
 *
 * 양보 불가 (decisions/realestate-data-policy):
 * - KNOWN_REGIONS_RONE 정적 사전만 (추측 금지, WO-018)
 * - 인증키 없으면 *샘플 10건만* 반환 — 운영은 반드시 인증키 설정
 */

import { z } from "zod";

// R-ONE은 통계청 KOSIS 호환 *통계코드* 체계 사용
// 우리는 *지역 alias*로 매핑 (KOSIS 통계지표 코드)
export const KNOWN_REGIONS_RONE: Record<string, {
  region_code: string;
  name_ko: string;
  name_en: string;
}> = {
  national: { region_code: "00", name_ko: "전국", name_en: "National" },
  seoul: { region_code: "11", name_ko: "서울특별시", name_en: "Seoul" },
  gangnam: { region_code: "11680", name_ko: "서울특별시 강남구", name_en: "Gangnam-gu" },
  seocho: { region_code: "11650", name_ko: "서울특별시 서초구", name_en: "Seocho-gu" },
  songpa: { region_code: "11710", name_ko: "서울특별시 송파구", name_en: "Songpa-gu" },
  incheon: { region_code: "28", name_ko: "인천광역시", name_en: "Incheon" },
  busan: { region_code: "26", name_ko: "부산광역시", name_en: "Busan" },
  daegu: { region_code: "27", name_ko: "대구광역시", name_en: "Daegu" },
  sejong: { region_code: "36", name_ko: "세종특별자치시", name_en: "Sejong" },
};

export type RoneRegion = keyof typeof KNOWN_REGIONS_RONE;

export function validateRoneRegion(region: string): asserts region is RoneRegion {
  if (!(region in KNOWN_REGIONS_RONE)) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["region"],
        message: `미등록 region: ${region}. KNOWN_REGIONS_RONE 등록: ${Object.keys(KNOWN_REGIONS_RONE).join(", ")}`,
      },
    ]);
  }
}

// R-ONE OpenAPI base
export const RONE_BASE_URL = "https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do";

// 통계표 코드 (KOSIS) — 사전 등록만, API 역검증 후 추가
export const RONE_STAT_CODES = {
  housing_index_apt_monthly: "A_2024_00045", // 월간 매매가격지수_아파트
  jeonse_ratio_monthly: "A_2024_00033",      // 매매가격대비 전세가격 비율 (사전 명세, API 역검증 필수)
} as const;

export type RoneStatCode = keyof typeof RONE_STAT_CODES;

// 출력 인터페이스
export interface RonePoint {
  date: string;      // ISO 8601 (YYYY-MM-01)
  value: number;
  unit: string;      // "지수" / "%" / ...
}

const RONE_CACHE = new Map<string, { ts: number; data: RonePoint[] }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface FetchRoneOptions {
  stat_code: RoneStatCode;
  region: RoneRegion;
  start_period: string; // YYYYMM
  end_period: string;
  api_key?: string;
}

export async function fetchRoneSeries(opts: FetchRoneOptions): Promise<RonePoint[]> {
  validateRoneRegion(opts.region);

  const cacheKey = `${opts.stat_code}|${opts.region}|${opts.start_period}|${opts.end_period}`;
  const cached = RONE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const apiKey = opts.api_key ?? process.env.RONE_API_KEY ?? "";
  if (!apiKey) {
    throw new Error(
      "[rone] RONE_API_KEY 미설정. wiki/.../api-key-issuance-guide-realestate.md Step 4 참조.",
    );
  }

  const meta = KNOWN_REGIONS_RONE[opts.region];
  const statId = RONE_STAT_CODES[opts.stat_code];
  if (!meta) throw new Error(`[rone] KNOWN_REGIONS_RONE 매핑 누락: ${opts.region}`);

  // R-ONE OpenAPI 파라미터 — 공식 명세 확인 후 정확화 (사전 명세)
  const params = new URLSearchParams({
    KEY: apiKey,
    Type: "json",
    pIndex: "1",
    pSize: "100",
    STATBL_ID: statId,
    DTACYCLE_CD: "MM", // 월별
    CLS_ID: meta.region_code,
    START_WRTTIME: opts.start_period,
    END_WRTTIME: opts.end_period,
  });
  const url = `${RONE_BASE_URL}?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[rone] R-ONE API HTTP ${res.status}`);
  }
  const json = (await res.json()) as Record<string, unknown>;

  // R-ONE 응답 파싱 — 정확한 키는 API 역검증 후 확정 (사전 명세)
  const rows = extractRoneRows(json);
  if (rows.length === 0) {
    throw new Error("INFO-200 해당하는 데이터가 없습니다 (R-ONE 응답 비어있음)");
  }

  const points: RonePoint[] = rows.map((row) => ({
    date: formatRoneDate(String(row["WRTTIME_DESC"] ?? row["WRTTIME_IDTFR_ID"] ?? "")),
    value: Number(row["DTA_VAL"] ?? 0),
    unit: String(row["UNIT_NM"] ?? "지수"),
  }));

  RONE_CACHE.set(cacheKey, { ts: Date.now(), data: points });
  return points;
}

// R-ONE 응답에서 row 배열 추출 (스키마 변형 대응)
function extractRoneRows(json: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(json["StatisticSearch"])) {
    const arr = json["StatisticSearch"] as Array<Record<string, unknown>>;
    const second = arr[1] as { row?: Array<Record<string, unknown>> } | undefined;
    return second?.row ?? [];
  }
  if (Array.isArray(json["row"])) {
    return json["row"] as Array<Record<string, unknown>>;
  }
  return [];
}

// R-ONE 날짜 (YYYYMM 또는 YYYY-MM) → ISO 8601
function formatRoneDate(raw: string): string {
  const cleaned = raw.replace(/[^0-9]/g, "");
  if (cleaned.length >= 6) {
    return `${cleaned.substring(0, 4)}-${cleaned.substring(4, 6)}-01T00:00:00Z`;
  }
  return raw;
}

// Mock 헬퍼 (테스트용)
export function _mockRonePoint(overrides: Partial<RonePoint> = {}): RonePoint {
  return {
    date: "2024-05-01T00:00:00Z",
    value: 102.3,
    unit: "지수",
    ...overrides,
  };
}
