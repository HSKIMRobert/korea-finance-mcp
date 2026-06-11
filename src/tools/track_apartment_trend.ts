/**
 * track_apartment_trend — 아파트 단지 실거래 추세 시계열 (v1.3, 18번째 도구)
 *
 * 기존 get_realestate_price의 RTMS 호출 로직(fetchRtmsTrades)을 재사용해
 * 기간 내 월별 순회 → 단지명 부분일치 필터 → 면적대별 월별 집계.
 *
 * @see wiki/korea-finance-mcp/tools-spec.md §2.5 (v1.3 추가)
 * @see wiki/decisions/korea-finance-mcp-rtms-rate-limit-policy-2026-W22.md
 *
 * 양보 불가 (회귀 re-19a~i):
 * - 과거 실거래 *산술 집계*만 — 예측/전망/추천/매수/매도 0건 (자본시장법 영구 잠금)
 * - MANDATORY_NOTES_TREND 자동 부착 (correlate_* 패턴)
 * - 월 순회 호출 사이 rateLimitDelay() 의무 (WO-005 250ms 패턴)
 * - INFO-200 = 해당 월 거래 0건 부분 성공 (re-13 패턴) / 비-INFO 에러는 throw (WO-024)
 * - RTMS 신고기한 30일 → 최근 1~2개월 불완전 warning을 meta에 의무 명시
 * - 기간 상한 24개월 (data.go.kr rate limit 보호)
 */

import { z } from "zod";
import { buildResponse, buildNoData } from "../lib/response.js";
import {
  fetchRtmsTrades,
  rateLimitDelay,
  KNOWN_REGIONS,
  RTMS_ENDPOINTS,
  type PropertyType,
  type RealEstateTrade,
} from "../lib/realestate.js";

// ============================================================
// 입력 스키마
// ============================================================
const YM_REGEX = /^\d{6}$/;

function isValidYm(ym: string): boolean {
  if (!YM_REGEX.test(ym)) return false;
  const month = Number(ym.slice(4, 6));
  return month >= 1 && month <= 12;
}

// ⚠️ 순수 ZodObject 유지 — superRefine/ZodEffects 금지.
//    index.ts·http.ts의 zodToJsonSchema가 `instanceof z.ZodObject`로 properties를 추출하므로
//    ZodEffects로 감싸면 클라이언트에 입력 필드가 노출되지 않음 (사일런트 실패).
//    기간 도메인 검증은 execute 내부에서 z.ZodError throw (correlate_* 기존 패턴).
export const TrackApartmentTrendInputSchema = z.object({
  region_code: z
    .string()
    .regex(/^\d{5}$/, "region_code는 5자리 법정동코드 (예: 11680 강남구)"),
  apt_name: z
    .string()
    .trim()
    .min(1, "apt_name은 단지명 부분일치 검색어 (예: 래미안)"),
  start_period: z.string().regex(YM_REGEX, "start_period는 YYYYMM 형식 (예: 202501)"),
  end_period: z.string().regex(YM_REGEX, "end_period는 YYYYMM 형식 (예: 202605)"),
  area: z
    .number()
    .positive("area는 전용면적 ㎡ (양수). ±2㎡ 허용 범위로 필터")
    .optional(),
  // WO-122: 연립다세대(예: 제주 정원파인즈 시리즈)도 추적 가능하도록 유형 추가
  property_type: z.enum(["apt", "villa", "house"]).optional().default("apt"),
});

export type TrackApartmentTrendInput = z.infer<typeof TrackApartmentTrendInputSchema>;

// ============================================================
// 상수 — 양보 불가
// ============================================================
export const MAX_TREND_MONTHS = 24;
export const AREA_TOLERANCE_M2 = 2;

/**
 * WO-123: 전체 실행 시한. fly 프록시(60s)·MCP 클라이언트 타임아웃 전에
 * *수집분만이라도* 정직하게 반환 (502로 전체 손실되는 것보다 부분 성공 + warning).
 */
export const TREND_DEADLINE_MS = 40_000;

/** RTMS 신고기한 30일 → 데이터 불완전으로 간주하는 최근 개월 수 (현재월 포함 2개월) */
export const INCOMPLETE_RECENT_MONTHS = 2;

// MANDATORY_NOTES — 응답에 *반드시* 모두 포함 (correlate_* 패턴, 회귀 re-19g 검증)
export const MANDATORY_NOTES_TREND = [
  "본 결과는 국토부 RTMS *과거 실거래 신고분의 산술 집계*이며, 시세·호가·미래 가격이 아닙니다.",
  "RTMS 신고기한은 거래 후 30일 — 최근 1~2개월 구간은 미신고 거래로 인해 불완전할 수 있습니다.",
  "거래 건수가 적은 월의 평균가는 개별 거래 1건에 좌우될 수 있습니다 (표본 주의).",
  "본 도구는 *예측·전망·매수·매도 추천이 아닙니다*. (자본시장법 영구 잠금)",
];

export const trackApartmentTrendTool = {
  name: "track_apartment_trend",
  title: "Korea Apartment Price Trend Tracker (RTMS)",
  description: [
    "단지 실거래 추세 시계열 (국토부 RTMS 월별 순회 집계).",
    "입력: region_code (5자리 법정동), apt_name (단지명 부분일치)",
    "      start_period/end_period (YYYYMM, 최대 24개월), area (전용㎡ ±2 허용, 선택)",
    "      property_type (apt|villa|house, default apt — 연립다세대는 villa)",
    "출력: 면적대별 월별 {거래건수·평균가·최저/최고가(만원)} + 직전월 대비 변동률(%)",
    "⚠️ 과거 실거래 집계만 — 예측/전망/추천 0건. 최근 1~2개월 신고 미완 warning 포함.",
  ].join("\n"),
  inputSchema: TrackApartmentTrendInputSchema,
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
} as const;

// ============================================================
// 내부 헬퍼
// ============================================================

/** YYYYMM 구간 → 월 배열 (양 끝 포함). start > end면 빈 배열. */
export function enumerateMonths(start: string, end: string): string[] {
  const months: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(4, 6));
  const ey = Number(end.slice(0, 4));
  const em = Number(end.slice(4, 6));
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/** 단지명 비교 정규화 — 공백 제거 + 소문자. ("래미안 강남" ≒ "래미안강남") */
function normalizeName(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** 현재 시각 기준, 신고 미완 가능성이 있는 최근 N개월 YYYYMM 목록 (현재월 포함) */
export function recentIncompleteMonths(now: Date = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < INCOMPLETE_RECENT_MONTHS; i++) {
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

interface MonthlyPoint {
  year_month: string;
  trade_count: number;
  avg_price: number | null; // 만원
  min_price: number | null; // 만원
  max_price: number | null; // 만원
  /** 직전월 대비 평균가 변동률 (%). 양쪽 월 모두 거래 있을 때만, 아니면 null. */
  mom_change_pct: number | null;
}

interface AreaBandSeries {
  /** 전용면적 정수 절사 밴드 (예: 84.93㎡ → 84) */
  area_band_m2: number;
  monthly: MonthlyPoint[];
}

// ============================================================
// 실행
// ============================================================
export async function executeTrackApartmentTrend(
  input: TrackApartmentTrendInput,
  deadlineMs: number = TREND_DEADLINE_MS, // 테스트 주입용 (운영은 기본값)
) {
  // 기간 도메인 검증 — execute 내부 ZodError throw (correlate_* 패턴)
  if (!isValidYm(input.start_period)) {
    throw new z.ZodError([
      { code: "custom", path: ["start_period"], message: `월은 01~12 (받은 값: ${input.start_period})` },
    ]);
  }
  if (!isValidYm(input.end_period)) {
    throw new z.ZodError([
      { code: "custom", path: ["end_period"], message: `월은 01~12 (받은 값: ${input.end_period})` },
    ]);
  }
  if (input.start_period > input.end_period) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["start_period"],
        message: `start_period(${input.start_period})가 end_period(${input.end_period})보다 늦음`,
      },
    ]);
  }

  const months = enumerateMonths(input.start_period, input.end_period);
  if (months.length > MAX_TREND_MONTHS) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["end_period"],
        message: `기간 최대 ${MAX_TREND_MONTHS}개월 (요청 ${months.length}개월). data.go.kr rate limit 보호 — 분할 조회 권장.`,
      },
    ]);
  }

  const regionMeta = KNOWN_REGIONS[input.region_code];
  const propType: PropertyType = input.property_type ?? "apt";
  const sourceUrl = RTMS_ENDPOINTS[propType];
  const warnings: string[] = [];

  // 1) 월별 순회 호출 — 기존 fetchRtmsTrades 재사용 (1시간 캐시 내장)
  //    WO-123: deadline 초과 시 *수집된 prefix까지만* 집계 (직렬 순회라 미수집은 항상 뒤쪽 연속 구간).
  //    미수집 월을 "거래 0건"으로 표시하면 환각 — 반드시 구간 자체를 잘라내고 warning으로 명시.
  const startedAt = Date.now();
  const tradesByMonth = new Map<string, RealEstateTrade[]>();
  const collectedMonths: string[] = [];
  let uncollectedMonths: string[] = [];
  for (let i = 0; i < months.length; i++) {
    const ym = months[i]!;
    if (Date.now() - startedAt > deadlineMs) {
      uncollectedMonths = months.slice(i);
      break;
    }
    if (i > 0) {
      await rateLimitDelay(); // WO-005: data.go.kr rate limit 보호 (호출 사이 250ms)
    }
    try {
      const trades = await fetchRtmsTrades({
        property_type: propType,
        region_code: input.region_code,
        year_month: ym,
      });
      tradesByMonth.set(ym, trades);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // INFO-200 부분 성공 (re-13 패턴) — 해당 월 거래 0건 처리
      if (/INFO-200|해당하는 데이터가 없습니다|no data/i.test(message)) {
        tradesByMonth.set(ym, []);
        warnings.push(`${ym}: 해당 월 거래 없음 (INFO-200)`);
      } else {
        throw err; // 비-INFO 에러 전파 (WO-024 패턴)
      }
    }
    collectedMonths.push(ym);
  }

  if (uncollectedMonths.length > 0) {
    warnings.push(
      `⏱ 실행 시간 제한(${Math.round(deadlineMs / 1000)}초)으로 ${uncollectedMonths[0]}~${uncollectedMonths[uncollectedMonths.length - 1]} (${uncollectedMonths.length}개월) 미수집 — ` +
        `해당 구간을 별도 조회로 이어주십시오 (이미 수집된 월은 서버 캐시 1시간 동안 재사용되어 빠릅니다).`,
    );
  }
  const effectiveMonths = collectedMonths;

  // 2) 단지명 부분일치 + 면적 필터
  const query = normalizeName(input.apt_name);
  const matchedNames = new Set<string>();
  let invalidAreaCount = 0;
  const filteredByMonth = new Map<string, RealEstateTrade[]>();

  for (const ym of effectiveMonths) {
    const filtered: RealEstateTrade[] = [];
    for (const t of tradesByMonth.get(ym) ?? []) {
      if (!normalizeName(t.complex_name).includes(query)) continue;
      if (t.unit_area <= 0) {
        invalidAreaCount += 1; // 면적 파싱 불능 — 집계 제외 (추측 금지: 임의 밴드 배정 안 함)
        continue;
      }
      if (
        input.area !== undefined &&
        Math.abs(t.unit_area - input.area) > AREA_TOLERANCE_M2
      ) {
        continue;
      }
      matchedNames.add(t.complex_name);
      filtered.push(t);
    }
    filteredByMonth.set(ym, filtered);
  }

  const totalMatched = [...filteredByMonth.values()].reduce((a, b) => a + b.length, 0);
  const lastUpdatedAt = new Date().toISOString();

  if (totalMatched === 0) {
    return buildNoData({
      source: "국토교통부 RTMS (실거래가 공개시스템)",
      source_url: sourceUrl,
      last_updated_at: lastUpdatedAt,
      warnings: [
        `'${input.apt_name}' 부분일치 단지의 거래가 ${input.start_period}~${input.end_period} 구간에 없음` +
          (input.area !== undefined ? ` (전용 ${input.area}±${AREA_TOLERANCE_M2}㎡ 필터 적용)` : ""),
        ...warnings,
      ],
    });
  }

  // 3) 면적대(정수 절사) × 월별 집계
  const bands = new Map<number, Map<string, { count: number; sum: number; min: number; max: number }>>();
  for (const ym of effectiveMonths) {
    for (const t of filteredByMonth.get(ym) ?? []) {
      const band = Math.floor(t.unit_area);
      if (!bands.has(band)) bands.set(band, new Map());
      const byMonth = bands.get(band)!;
      const cur = byMonth.get(ym);
      if (!cur) {
        byMonth.set(ym, { count: 1, sum: t.price, min: t.price, max: t.price });
      } else {
        cur.count += 1;
        cur.sum += t.price;
        cur.min = Math.min(cur.min, t.price);
        cur.max = Math.max(cur.max, t.price);
      }
    }
  }

  // 4) 시계열 생성 — 빈 월도 포함 (데이터 없음을 숨기지 않음) + 직전월 대비 변동률
  const series: AreaBandSeries[] = [...bands.keys()]
    .sort((a, b) => a - b)
    .map((band) => {
      const byMonth = bands.get(band)!;
      const monthly: MonthlyPoint[] = [];
      let prevAvg: number | null = null;
      for (const ym of effectiveMonths) {
        const agg = byMonth.get(ym);
        if (!agg) {
          monthly.push({
            year_month: ym,
            trade_count: 0,
            avg_price: null,
            min_price: null,
            max_price: null,
            mom_change_pct: null,
          });
          prevAvg = null; // 공백 월 이후엔 직전월 비교 불가 (보간 금지)
          continue;
        }
        const avg = Math.round(agg.sum / agg.count);
        const mom =
          prevAvg !== null && prevAvg !== 0
            ? Number((((avg - prevAvg) / prevAvg) * 100).toFixed(2))
            : null;
        monthly.push({
          year_month: ym,
          trade_count: agg.count,
          avg_price: avg,
          min_price: agg.min,
          max_price: agg.max,
          mom_change_pct: mom,
        });
        prevAvg = avg;
      }
      return { area_band_m2: band, monthly };
    });

  // 5) RTMS 신고기한 30일 — 조회 구간에 최근 1~2개월 포함 시 의무 warning (요구사항 #4)
  const incompleteSet = new Set(recentIncompleteMonths());
  const incompleteInRange = effectiveMonths.filter((m) => incompleteSet.has(m));
  if (incompleteInRange.length > 0) {
    warnings.push(
      `⚠️ ${incompleteInRange.join(", ")} 데이터는 불완전할 수 있음 — RTMS 신고기한은 거래 후 30일로, 최근 1~2개월 거래는 미신고분이 존재할 수 있습니다.`,
    );
  }
  if (invalidAreaCount > 0) {
    warnings.push(`전용면적 파싱 불능으로 집계 제외된 거래 ${invalidAreaCount}건`);
  }

  const meta = {
    region_code: input.region_code,
    region_name: regionMeta?.name_ko ?? `법정동 코드 ${input.region_code}`,
    property_type: propType,
    apt_name_query: input.apt_name,
    matched_complex_names: [...matchedNames].sort(),
    period: {
      start: input.start_period,
      end: input.end_period,
      // WO-123: deadline 부분 수집 시 실제 집계 종료 월 (전체 수집 시 end와 동일)
      end_collected: effectiveMonths[effectiveMonths.length - 1] ?? null,
    },
    months_requested: months.length,
    months_scanned: effectiveMonths.length,
    area_filter:
      input.area !== undefined
        ? { target_m2: input.area, tolerance_m2: AREA_TOLERANCE_M2 }
        : null,
    total_trades_matched: totalMatched,
    price_unit: "만원",
    incomplete_recent_months: incompleteInRange, // 신고기한 30일 미경과 가능 구간
    data_lag_note:
      "RTMS는 거래 후 30일 이내 신고 의무 — 최근 1~2개월은 미신고분으로 불완전 가능",
  };

  return buildResponse({
    source: "국토교통부 RTMS (실거래가 공개시스템)",
    source_url: sourceUrl,
    last_updated_at: lastUpdatedAt,
    data: {
      meta,
      series,
      notes: MANDATORY_NOTES_TREND, // ⚠️ 양보 불가
      warnings,
    },
  });
}
