/**
 * 회귀 re-19a ~ re-19k — track_apartment_trend (v1.3, 18번째 도구)
 *
 * @see src/tools/track_apartment_trend.ts
 * @see wiki/korea-finance-mcp/hallucination-tests.md
 *
 * 양보 불가 검증:
 * - 산술 집계 정확성 (avg/min/max/count/MoM)
 * - 단지명 부분일치 (공백 정규화)
 * - area ±2㎡ 경계
 * - INFO-200 부분 성공 / 비-INFO throw (WO-024)
 * - MANDATORY_NOTES_TREND 의무 부착 + 해석 필드 0건
 * - RTMS 신고기한 30일 warning (최근 1~2개월)
 * - rateLimitDelay 호출 횟수 (WO-005)
 * - 빈 월 보간 금지 (mom null)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("../../src/lib/realestate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/realestate.js")>();
  return {
    ...actual,
    fetchRtmsTrades: vi.fn(),
    rateLimitDelay: vi.fn(), // 250ms 지연 → 테스트에서 0ms (fake timer 사전 래핑 패턴)
  };
});

import {
  executeTrackApartmentTrend,
  TrackApartmentTrendInputSchema,
  MANDATORY_NOTES_TREND,
  enumerateMonths,
  recentIncompleteMonths,
} from "../../src/tools/track_apartment_trend.js";
import { _mockRtmsTrade, fetchRtmsTrades, rateLimitDelay } from "../../src/lib/realestate.js";
import { assertStandardResponse } from "../setup.js";

const mockFetch = vi.mocked(fetchRtmsTrades);
const mockDelay = vi.mocked(rateLimitDelay);

type TrendData = {
  meta: {
    region_name: string;
    matched_complex_names: string[];
    total_trades_matched: number;
    months_requested: number;
    months_scanned: number;
    incomplete_recent_months: string[];
    area_filter: { target_m2: number; tolerance_m2: number } | null;
  };
  series: Array<{
    area_band_m2: number;
    monthly: Array<{
      year_month: string;
      trade_count: number;
      avg_price: number | null;
      min_price: number | null;
      max_price: number | null;
      mom_change_pct: number | null;
    }>;
  }>;
  notes: string[];
  warnings: string[];
};

function parseInput(overrides: Record<string, unknown> = {}) {
  return TrackApartmentTrendInputSchema.parse({
    region_code: "11680",
    apt_name: "래미안",
    start_period: "202501",
    end_period: "202503",
    ...overrides,
  });
}

describe("track_apartment_trend 회귀 re-19a~k", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockDelay.mockReset();
    mockDelay.mockResolvedValue(undefined);
  });

  it("re-19a: 3개월 집계 정확성 — avg/min/max/count + MoM 변동률", async () => {
    mockFetch.mockImplementation(async ({ year_month }) => {
      if (year_month === "202501") {
        return [
          _mockRtmsTrade({ complex_name: "래미안강남", unit_area: 84.93, price: 100000 }),
          _mockRtmsTrade({ complex_name: "래미안강남", unit_area: 84.86, price: 110000 }),
        ];
      }
      if (year_month === "202502") {
        return [_mockRtmsTrade({ complex_name: "래미안강남", unit_area: 84.91, price: 121000 })];
      }
      return [_mockRtmsTrade({ complex_name: "래미안강남", unit_area: 84.91, price: 115000 })];
    });

    const result = await executeTrackApartmentTrend(parseInput());
    assertStandardResponse(result);
    const data = (result as { data: TrendData }).data;

    expect(data.meta.region_name).toContain("강남");
    expect(data.meta.total_trades_matched).toBe(4);
    expect(data.series).toHaveLength(1); // 84 단일 밴드

    const band = data.series[0]!;
    expect(band.area_band_m2).toBe(84);

    const [m1, m2, m3] = band.monthly;
    // 202501: (100000+110000)/2 = 105000, min 100000, max 110000
    expect(m1).toMatchObject({
      year_month: "202501",
      trade_count: 2,
      avg_price: 105000,
      min_price: 100000,
      max_price: 110000,
      mom_change_pct: null, // 첫 월
    });
    // 202502: 121000, MoM = (121000-105000)/105000*100 = 15.24
    expect(m2!.avg_price).toBe(121000);
    expect(m2!.mom_change_pct).toBe(15.24);
    // 202503: 115000, MoM = (115000-121000)/121000*100 = -4.96
    expect(m3!.avg_price).toBe(115000);
    expect(m3!.mom_change_pct).toBe(-4.96);
  });

  it("re-19b: 단지명 부분일치 + 공백 정규화 (래미안 강남 ≒ 래미안강남)", async () => {
    mockFetch.mockResolvedValue([
      _mockRtmsTrade({ complex_name: "래미안 강남", unit_area: 84.9, price: 100000 }),
      _mockRtmsTrade({ complex_name: "래미안서초", unit_area: 59.9, price: 80000 }),
      _mockRtmsTrade({ complex_name: "힐스테이트", unit_area: 84.9, price: 90000 }),
    ]);

    const result = await executeTrackApartmentTrend(
      parseInput({ apt_name: "래미안", start_period: "202501", end_period: "202501" }),
    );
    const data = (result as { data: TrendData }).data;

    expect(data.meta.matched_complex_names).toEqual(["래미안 강남", "래미안서초"]);
    expect(data.meta.total_trades_matched).toBe(2);
    // 힐스테이트 미포함
    expect(JSON.stringify(data)).not.toContain("힐스테이트");
  });

  it("re-19c: area ±2㎡ 경계 — diff 2.0 포함, 2.5 제외", async () => {
    mockFetch.mockResolvedValue([
      _mockRtmsTrade({ complex_name: "래미안A", unit_area: 84.5, price: 100000 }), // diff 0.5 ✅
      _mockRtmsTrade({ complex_name: "래미안B", unit_area: 82.0, price: 90000 }), // diff 2.0 ✅ (경계)
      _mockRtmsTrade({ complex_name: "래미안C", unit_area: 86.5, price: 110000 }), // diff 2.5 ❌
    ]);

    const result = await executeTrackApartmentTrend(
      parseInput({ area: 84, start_period: "202501", end_period: "202501" }),
    );
    const data = (result as { data: TrendData }).data;

    expect(data.meta.total_trades_matched).toBe(2);
    expect(data.meta.area_filter).toEqual({ target_m2: 84, tolerance_m2: 2 });
    expect(data.meta.matched_complex_names).toEqual(["래미안A", "래미안B"]);
  });

  it("re-19d: 전 기간 매칭 0건 → buildNoData + warnings", async () => {
    mockFetch.mockResolvedValue([
      _mockRtmsTrade({ complex_name: "힐스테이트", unit_area: 84.9, price: 90000 }),
    ]);

    const result = await executeTrackApartmentTrend(parseInput({ apt_name: "없는단지" }));
    assertStandardResponse(result, { allowNoData: true });
    expect((result as { data: unknown }).data).toBeNull();
    expect((result as { warnings: string[] }).warnings.join()).toContain("없는단지");
  });

  it("re-19e: INFO-200 월 → 부분 성공 (해당 월 0건 + warning, 나머지 정상)", async () => {
    mockFetch.mockImplementation(async ({ year_month }) => {
      if (year_month === "202502") {
        throw new Error("INFO-200 해당하는 데이터가 없습니다");
      }
      return [_mockRtmsTrade({ complex_name: "래미안강남", unit_area: 84.9, price: 100000 })];
    });

    const result = await executeTrackApartmentTrend(parseInput());
    assertStandardResponse(result);
    const data = (result as { data: TrendData }).data;

    expect(data.warnings.join()).toContain("202502");
    const monthly = data.series[0]!.monthly;
    expect(monthly[1]).toMatchObject({ year_month: "202502", trade_count: 0, avg_price: null });
  });

  it("re-19f: 비-INFO 에러 → throw 전파 (WO-024 패턴)", async () => {
    mockFetch.mockRejectedValue(new Error("HTTP 500 Server Error"));
    await expect(executeTrackApartmentTrend(parseInput())).rejects.toThrow("HTTP 500");
  });

  it("re-19g: MANDATORY_NOTES_TREND 전건 부착 + 해석 필드 0건", async () => {
    mockFetch.mockResolvedValue([
      _mockRtmsTrade({ complex_name: "래미안강남", unit_area: 84.9, price: 100000 }),
    ]);

    const result = await executeTrackApartmentTrend(
      parseInput({ start_period: "202501", end_period: "202501" }),
    );
    const data = (result as { data: TrendData }).data;

    // notes 의무 부착 (재구성·축약 금지)
    expect(data.notes).toEqual(MANDATORY_NOTES_TREND);

    // 해석·전망 필드 자체가 존재하지 않아야 함 (구조 레벨 차단)
    const serialized = JSON.stringify(data);
    for (const forbiddenKey of ["interpretation", "forecast", "recommendation", "outlook", "signal"]) {
      expect(serialized, `해석 필드 "${forbiddenKey}" 금지`).not.toContain(`"${forbiddenKey}"`);
    }
    // 행동 유도 표현 0건 — notes는 의도적 *부정문*("매수·매도 추천이 아닙니다")을 담으므로
    // substring 오탐 방지 위해 notes 제외 직렬화로 검사 (notes 전문은 위 toEqual로 이미 검증).
    // notes 제외 영역(meta·series·warnings)은 단독 단어 수준까지 0건 강제.
    const { notes: _notes, ...dataWithoutNotes } = data;
    const serializedNoNotes = JSON.stringify(dataWithoutNotes);
    for (const banned of ["추천", "전망", "예측", "매수", "매도", "사야", "팔아야", "상승할", "하락할"]) {
      expect(serializedNoNotes, `금지 표현 "${banned}" (notes 외 영역)`).not.toContain(banned);
    }
  });

  it("re-19h: 조회 범위에 최근 1~2개월 포함 → 신고기한 30일 warning 의무", async () => {
    mockFetch.mockResolvedValue([
      _mockRtmsTrade({ complex_name: "래미안강남", unit_area: 84.9, price: 100000 }),
    ]);

    // 현재월을 동적으로 end_period로 — 신고 미완 구간 강제 포함
    const now = new Date();
    const cur = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    const start = `${prev.getUTCFullYear()}${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;

    const result = await executeTrackApartmentTrend(
      parseInput({ start_period: start, end_period: cur }),
    );
    const data = (result as { data: TrendData }).data;

    expect(data.meta.incomplete_recent_months.length).toBeGreaterThan(0);
    expect(data.meta.incomplete_recent_months).toContain(cur);
    expect(data.warnings.join()).toContain("신고기한");
  });

  it("re-19i: 월 순회 호출 사이 rateLimitDelay — 3개월 = 2회 (WO-005)", async () => {
    mockFetch.mockResolvedValue([
      _mockRtmsTrade({ complex_name: "래미안강남", unit_area: 84.9, price: 100000 }),
    ]);

    await executeTrackApartmentTrend(parseInput()); // 202501~202503 = 3개월
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockDelay).toHaveBeenCalledTimes(2); // 호출 *사이*에만
  });

  it("re-19j: 기간 검증 — 역전·25개월 초과·잘못된 월 → ZodError", async () => {
    await expect(
      executeTrackApartmentTrend(parseInput({ start_period: "202506", end_period: "202501" })),
    ).rejects.toThrow(z.ZodError);

    await expect(
      executeTrackApartmentTrend(parseInput({ start_period: "202401", end_period: "202601" })), // 25개월
    ).rejects.toThrow(z.ZodError);

    await expect(
      executeTrackApartmentTrend(parseInput({ start_period: "202513", end_period: "202601" })), // 13월
    ).rejects.toThrow(z.ZodError);

    // 스키마 레벨: region_code 4자리
    expect(() => parseInput({ region_code: "1168" })).toThrow(z.ZodError);
    // 스키마 레벨: apt_name 빈 문자열
    expect(() => parseInput({ apt_name: "  " })).toThrow(z.ZodError);
  });

  it("re-19k: 빈 월 보간 금지 — 공백 월 이후 MoM null", async () => {
    mockFetch.mockImplementation(async ({ year_month }) => {
      if (year_month === "202502") return []; // 거래 없는 월
      return [_mockRtmsTrade({ complex_name: "래미안강남", unit_area: 84.9, price: 100000 })];
    });

    const result = await executeTrackApartmentTrend(parseInput());
    const monthly = (result as { data: TrendData }).data.series[0]!.monthly;

    expect(monthly[1]).toMatchObject({ year_month: "202502", trade_count: 0, avg_price: null, mom_change_pct: null });
    // 202503은 직전월(202502) 데이터 없음 → 보간·건너뛰기 비교 금지 → null
    expect(monthly[2]!.mom_change_pct).toBeNull();
  });

  it("re-19n: property_type 전달 — villa 지정 시 fetchRtmsTrades에 villa로 위임 (WO-122)", async () => {
    mockFetch.mockResolvedValue([
      _mockRtmsTrade({ complex_name: "정원파인즈16차", unit_area: 70.75, price: 23700 }),
    ]);
    const result = await executeTrackApartmentTrend(
      parseInput({ apt_name: "정원파인즈", property_type: "villa", start_period: "202501", end_period: "202501" }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ property_type: "villa" }),
    );
    const data = (result as { data: { meta: { property_type: string } } }).data;
    expect(data.meta.property_type).toBe("villa");
    // 미지정 시 기본 apt
    expect(TrackApartmentTrendInputSchema.parse({
      region_code: "11680", apt_name: "래미안", start_period: "202501", end_period: "202501",
    }).property_type).toBe("apt");
  });

  it("re-19p: deadline 초과 시 부분 수집 — prefix만 집계 + 미수집 구간 warning (WO-123)", async () => {
    mockFetch.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 15)); // 월당 15ms 소요 시뮬레이션
      return [_mockRtmsTrade({ complex_name: "래미안강남", unit_area: 84.9, price: 100000 })];
    });

    // deadline 10ms: 1번째 월 수집(15ms 소요) 후 2번째 월 체크에서 중단 확정
    const result = await executeTrackApartmentTrend(parseInput(), 10);
    const data = (result as { data: TrendData }).data;

    expect(data.meta.months_requested).toBe(3);
    expect(data.meta.months_scanned).toBe(1); // prefix만
    expect(data.series[0]!.monthly).toHaveLength(1); // 미수집 월을 0건으로 위장하지 않음
    const w = data.warnings.join();
    expect(w).toContain("미수집");
    expect(w).toContain("202502"); // 미수집 시작 월 명시
  });

  it("re-19l: enumerateMonths 연말 경계 (202411→202502 = 4개월)", () => {
    expect(enumerateMonths("202411", "202502")).toEqual(["202411", "202412", "202501", "202502"]);
    expect(enumerateMonths("202501", "202501")).toEqual(["202501"]);
  });

  it("re-19m: recentIncompleteMonths — 현재월 포함 2개월", () => {
    const months = recentIncompleteMonths(new Date(Date.UTC(2026, 5, 11))); // 2026-06-11
    expect(months).toEqual(["202606", "202605"]);
  });
});
