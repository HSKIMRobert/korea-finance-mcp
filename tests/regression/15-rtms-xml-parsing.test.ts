/**
 * 회귀 re-20a ~ re-20d — RTMS XML 파싱 (WO-122 핫픽스 고정)
 *
 * 배경: 기존 회귀 전부가 fetchRtmsTrades를 mock → *XML 파싱 경로가 무검증*이었음.
 *   그 사이 <item> 래퍼 자기-매치 버그로 prod에서 "100건 전부 빈 값" 발생 (2026-06-11).
 *   본 파일은 fetch만 stub하고 *진짜 파서*를 실측 XML 픽스처로 검증한다.
 *
 * 픽스처 출처: fly ssh 실측 (RTMSDataSvcRHTrade, 50110, 202604) — 영문 태그 체계.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { fetchRtmsTrades } from "../../src/lib/realestate.js";
import {
  executeTrackApartmentTrend,
  TrackApartmentTrendInputSchema,
} from "../../src/tools/track_apartment_trend.js";

// ── 실측 기반 픽스처 (영문 태그 + 빈 태그 <cdealDay> 공백 포함 원형 보존) ──
const VILLA_XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items><item><buildYear>2011</buildYear><buyerGbn>개인</buyerGbn><cdealDay> </cdealDay><cdealType> </cdealType><dealAmount>23,700</dealAmount><dealDay>19</dealDay><dealMonth>4</dealMonth><dealYear>2026</dealYear><dealingGbn>중개거래</dealingGbn><excluUseAr>70.75</excluUseAr><floor>4</floor><houseType>다세대</houseType><jibun>2802-1</jibun><landAr>121.51</landAr><mhouseNm>방선문빌리지</mhouseNm><rgstDate> </rgstDate><sggCd>50110</sggCd><umdNm>아라일동</umdNm></item><item><buildYear>1990</buildYear><dealAmount>7,000</dealAmount><dealDay>29</dealDay><dealMonth>4</dealMonth><dealYear>2026</dealYear><excluUseAr>43.2</excluUseAr><floor>1</floor><houseType>연립</houseType><jibun>1957-4</jibun><mhouseNm>연동시영주택</mhouseNm><sggCd>50110</sggCd><umdNm>연동</umdNm></item></items><numOfRows>2</numOfRows><pageNo>1</pageNo><totalCount>148</totalCount></body></response>`;

const VILLA_XML_JUNGWON = VILLA_XML.replace("방선문빌리지", "정원파인즈16차");

const APT_XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items><item><aptNm>래미안픽스처</aptNm><buildYear>2010</buildYear><dealAmount>250,000</dealAmount><dealDay>5</dealDay><dealMonth>3</dealMonth><dealYear>2026</dealYear><excluUseAr>84.93</excluUseAr><floor>12</floor><jibun>736-8</jibun><sggCd>11680</sggCd><umdNm>대치동</umdNm></item></items><numOfRows>1</numOfRows><pageNo>1</pageNo><totalCount>1</totalCount></body></response>`;

function stubFetch(xml: string) {
  const fn = vi.fn(async () => new Response(xml, { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("RTMS XML 파싱 회귀 re-20a~d (WO-122)", () => {
  beforeEach(() => {
    process.env.DATA_GO_KR_API_KEY = "test-rtms-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-20a: <item> 래퍼 자기-매치 금지 — villa 실측 XML 전 필드 정상 추출", async () => {
    stubFetch(VILLA_XML);
    // 캐시 회피: 본 파일 내 고유 (region, ym) 조합 사용
    const trades = await fetchRtmsTrades({
      property_type: "villa",
      region_code: "50110",
      year_month: "202501",
    });

    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({
      complex_name: "방선문빌리지",
      unit_area: 70.75,
      price: 23700, // "23,700" 콤마 제거
      trade_date: "2026-04-19T00:00:00Z",
      floor: 4,
      jibun: "2802-1",
    });
    expect(trades[1]).toMatchObject({
      complex_name: "연동시영주택",
      unit_area: 43.2,
      price: 7000,
      trade_date: "2026-04-29T00:00:00Z",
      floor: 1,
      jibun: "1957-4",
    });
    // 빈 값 회귀 차단 — 단 1건이라도 빈 단지명/0가격이면 fail
    for (const t of trades) {
      expect(t.complex_name).not.toBe("");
      expect(t.price).toBeGreaterThan(0);
      expect(t.trade_date).not.toContain("-00-00");
    }
  });

  it("re-20b: apt 영문 태그 aptNm 매핑", async () => {
    stubFetch(APT_XML);
    const trades = await fetchRtmsTrades({
      property_type: "apt",
      region_code: "11680",
      year_month: "202502",
    });
    expect(trades).toHaveLength(1);
    expect(trades[0]!.complex_name).toBe("래미안픽스처");
    expect(trades[0]!.price).toBe(250000);
    expect(trades[0]!.unit_area).toBe(84.93);
  });

  it("re-20c: dong/ho 마스킹 유지 — 신 태그 체계에서도 개인정보 필드 미생성", async () => {
    stubFetch(VILLA_XML);
    const trades = await fetchRtmsTrades({
      property_type: "villa",
      region_code: "50110",
      year_month: "202502",
    });
    expect(trades[0]).not.toHaveProperty("dong");
    expect(trades[0]).not.toHaveProperty("ho");
  });

  it("re-20d: 통합 — fetch(stub) → 진짜 파서 → track_apartment_trend 부분일치·집계 (정원파인즈 케이스)", async () => {
    stubFetch(VILLA_XML_JUNGWON);
    const input = TrackApartmentTrendInputSchema.parse({
      region_code: "50110",
      apt_name: "정원파인즈",
      start_period: "202503",
      end_period: "202503", // 1개월 = rateLimitDelay 0회 (실 250ms 지연 없음)
      property_type: "villa",
    });
    const result = await executeTrackApartmentTrend(input);
    const data = (result as {
      data: {
        meta: { property_type: string; total_trades_matched: number; matched_complex_names: string[] };
        series: Array<{ area_band_m2: number; monthly: Array<{ trade_count: number; avg_price: number | null }> }>;
      };
    }).data;

    expect(data.meta.property_type).toBe("villa");
    expect(data.meta.total_trades_matched).toBe(1);
    expect(data.meta.matched_complex_names).toEqual(["정원파인즈16차"]);
    expect(data.series[0]!.area_band_m2).toBe(70);
    expect(data.series[0]!.monthly[0]).toMatchObject({ trade_count: 1, avg_price: 23700 });
  });
});
