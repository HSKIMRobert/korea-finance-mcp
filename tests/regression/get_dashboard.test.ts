/**
 * 회귀 테스트 — get_dashboard
 *
 * 시나리오 5건. 환각 방지 + 정적 사전 일괄 조회 특화 룰 검증.
 *
 *   #1 정상 — 사전 N건 모두 최신값 반환 + 표준 4필드 + generated_at ISO + last_updated_at은 ECOS TIME 기반
 *   #2 일부 빈값 — 해당 코드 skip + warnings + meta.skipped_codes 정확
 *   #3 전체 빈값 → buildNoData
 *   #4 1개 ECOS 에러 → throw 전파 (WO-005 패턴: promise expect 먼저 wrap)
 *   #5 KNOWN_INDICATORS 사전 정합성 — 호출 횟수 = 사전 항목 수
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertStandardResponse, makeEcosResponse } from "../setup.js";

vi.mock("../../src/lib/ecos.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/ecos.js")>();
  return {
    ...actual,
    fetchEcosStatistic: vi.fn(),
  };
});

import * as ecos from "../../src/lib/ecos.js";
import { executeGetDashboard } from "../../src/tools/get_dashboard.js";
import { KNOWN_INDICATORS } from "../../src/tools/search_indicator.js";

const mockFetch = vi.mocked(ecos.fetchEcosStatistic);
const N = KNOWN_INDICATORS.length;

describe("get_dashboard — 회귀 5건", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    ecos.clearEcosCache();
    vi.useFakeTimers();
  });

  // ──────────────────────────────────────────────
  // #1 정상 — 사전 N건 모두 응답
  // ──────────────────────────────────────────────
  it("#1 사전 모든 지표 최신값 반환 + 표준 4필드 + generated_at ISO", async () => {
    // 사전 각 항목에 대해 정상 응답 mock (TIME은 코드별 차별화)
    KNOWN_INDICATORS.forEach((ind, idx) => {
      mockFetch.mockResolvedValueOnce(
        makeEcosResponse([
          {
            STAT_CODE: ind.code,
            STAT_NAME: ind.name,
            TIME: `2024050${idx + 1}`,
            DATA_VALUE: "1.0",
            UNIT_NAME: ind.unit,
          },
        ]),
      );
    });

    const promise = executeGetDashboard({});
    // N개 호출 사이 (N-1)번의 250ms sleep
    await vi.advanceTimersByTimeAsync(250 * N);
    const res = await promise;

    assertStandardResponse(res);
    expect(res.data!.indicators.length).toBe(N);
    expect(res.data!.indicators[0].indicator_code).toBe(
      KNOWN_INDICATORS[0]!.code,
    );
    // generated_at은 ISO 8601 형식
    expect(res.data!.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // last_updated_at은 ECOS TIME 기반 ISO (현재 시각 아님)
    expect(res.last_updated_at).toMatch(/^2024-/);
    expect(res.meta?.returned).toBe(N);
    expect(res.meta?.skipped).toBe(0);
  });

  // ──────────────────────────────────────────────
  // #2 일부 빈값 → skip + warnings
  // ──────────────────────────────────────────────
  it("#2 1개 지표가 빈 응답이면 해당 코드 skip + warnings + meta.skipped_codes", async () => {
    // 첫 항목 정상, 나머지는 row 0건
    mockFetch.mockResolvedValueOnce(
      makeEcosResponse([
        {
          STAT_CODE: KNOWN_INDICATORS[0]!.code,
          STAT_NAME: KNOWN_INDICATORS[0]!.name,
          TIME: "20240501",
          DATA_VALUE: "3.5",
          UNIT_NAME: KNOWN_INDICATORS[0]!.unit,
        },
      ]),
    );
    for (let i = 1; i < N; i++) {
      mockFetch.mockResolvedValueOnce(makeEcosResponse([]));
    }

    const promise = executeGetDashboard({});
    await vi.advanceTimersByTimeAsync(250 * N);
    const res = await promise;

    assertStandardResponse(res);
    expect(res.data!.indicators.length).toBe(1);
    expect(res.meta?.returned).toBe(1);
    expect(res.meta?.skipped).toBe(N - 1);
    expect(res.meta?.skipped_codes).toEqual(
      KNOWN_INDICATORS.slice(1).map((i) => i.code),
    );
    expect(res.warnings).toBeDefined();
    expect(res.warnings![0]).toContain("최신 데이터 없음");
    expect(res.warnings![0]).toContain("보간·추측하지 않");
  });

  // ──────────────────────────────────────────────
  // #3 전체 빈값 → buildNoData
  // ──────────────────────────────────────────────
  it("#3 모든 지표가 빈 응답이면 buildNoData (보간·추측 금지)", async () => {
    for (let i = 0; i < N; i++) {
      mockFetch.mockResolvedValueOnce(makeEcosResponse([]));
    }

    const promise = executeGetDashboard({});
    await vi.advanceTimersByTimeAsync(250 * N);
    const res = await promise;

    assertStandardResponse(res, { allowNoData: true });
    expect(res.data).toBeNull();
  });

  // ──────────────────────────────────────────────
  // #4 1개 ECOS 에러 → throw 전파 (WO-005 패턴)
  // ──────────────────────────────────────────────
  it("#4 N개 중 1개라도 ECOS 에러면 throw 전파 (부분 성공으로 환각 만들지 않음)", async () => {
    // 첫 항목 정상, 두 번째에서 에러
    mockFetch.mockResolvedValueOnce(
      makeEcosResponse([
        {
          STAT_CODE: KNOWN_INDICATORS[0]!.code,
          STAT_NAME: KNOWN_INDICATORS[0]!.name,
          TIME: "20240501",
          DATA_VALUE: "1.0",
          UNIT_NAME: KNOWN_INDICATORS[0]!.unit,
        },
      ]),
    );
    if (N >= 2) {
      mockFetch.mockRejectedValueOnce(
        new Error("[ecos] API 에러 INFO-400: 일시적 장애"),
      );
    } else {
      // 사전 항목이 1개뿐이면 본 시나리오 무의미 → 첫 항목을 에러로 변경
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new Error("[ecos] API 에러 INFO-400: 일시적 장애"),
      );
    }

    // WO-005 패턴: promise 생성 직후 expect.rejects로 먼저 wrapping (unhandled rejection 방지)
    const promise = executeGetDashboard({});
    const assertion = expect(promise).rejects.toThrow(/INFO-400|일시적 장애/);
    await vi.advanceTimersByTimeAsync(250 * N);
    await assertion;
  });

  // ──────────────────────────────────────────────
  // #5 KNOWN_INDICATORS 사전 정합성
  // ──────────────────────────────────────────────
  it("#5 fetch 호출 횟수 = KNOWN_INDICATORS 항목 수 (사전 정합성)", async () => {
    KNOWN_INDICATORS.forEach((ind, idx) => {
      mockFetch.mockResolvedValueOnce(
        makeEcosResponse([
          {
            STAT_CODE: ind.code,
            STAT_NAME: ind.name,
            TIME: `2024050${idx + 1}`,
            DATA_VALUE: "1.0",
            UNIT_NAME: ind.unit,
          },
        ]),
      );
    });

    const promise = executeGetDashboard({});
    await vi.advanceTimersByTimeAsync(250 * N);
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(N);
    // 각 호출이 사전의 statCode를 올바르게 전달했는지
    KNOWN_INDICATORS.forEach((ind, idx) => {
      const call = mockFetch.mock.calls[idx]![0];
      expect(call.statCode).toBe(ind.code);
      expect(call.cycle).toBe(ind.cycle);
    });
  });
});
