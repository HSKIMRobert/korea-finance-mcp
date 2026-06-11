/**
 * 회귀 re-21a ~ re-21g — search_company (v1.4, 19번째 도구, WO-124)
 *
 * 픽스처: tests/fixtures/corpcode-mock*.zip — Python zipfile(외부 검증 구현)로 생성.
 *   파서(unzipSingleEntry)와 생성기가 독립적이어야 자기참조 함정이 없다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

import {
  unzipSingleEntry,
  loadCorpDirectory,
  searchCorpByName,
  _resetCorpDirCache,
} from "../../src/lib/dart.js";
import {
  executeSearchCompany,
  SearchCompanyInputSchema,
} from "../../src/tools/search_company.js";
import { assertStandardResponse } from "../setup.js";

// 픽스처: Python zipfile(외부 검증 구현)로 생성한 실물 zip을 base64 내장.
//   파일 의존 제거 — CI·로컬 어디서든 동일. 내용: 삼양식품(상장 003230) +
//   삼양식품판매·삼양식품그룹지원(비상장) + 삼성전자(005930), 4개사.
const ZIP_DEFLATED = Buffer.from(
  "UEsDBBQAAAAIAAJGy1xU4LGhHQEAAA4EAAAMAAAAQ09SUENPREUueG1ss7GvyM1RKEstKs7Mz7NVMtQzUFJIzUvOT8nMS7dVCg1x07VQsrfjsilKLS7NKbHjUgACm5zMYigTzE3OLyqIB2pJtTMwMDQyNDcys9FHiKGpy0vMTbV707TnzbSJb7rnvp3UAVULFkdTm5qXDhEPdvSNdPRzV3Dz93cJVnD219PxCXHRg+qEq0LoLi7JT86GOcnYyNjARh9JCKEuF+jPtMr4lMSSVDsjAyMzA0MDQxt9ZFGIh/URPsbneUsQMCTF8297JrxevoSYICDKswr08aehkZmxhQEx/mzZ+GZBy5t5E4iM5OBQYCS7+rg6hwT5+3k6g6JaRw8Y1UTGtKklXWPaiJSYfrV9x+vFO98sb3gzm6jQoGd82+hDszcAUEsBAhQDFAAAAAgAAkbLXFTgsaEdAQAADgQAAAwAAAAAAAAAAAAAAIABAAAAAENPUlBDT0RFLnhtbFBLBQYAAAAAAQABADoAAABHAQAAAAA=",
  "base64",
);
const ZIP_STORED = Buffer.from(
  "UEsDBBQAAAAAAAJGy1xU4LGhDgQAAA4EAAAMAAAAQ09SUENPREUueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHJlc3VsdD4KICAgIDxsaXN0PgogICAgICAgIDxjb3JwX2NvZGU+MDAxMjE3MjY8L2NvcnBfY29kZT4KICAgICAgICA8Y29ycF9uYW1lPuyCvOyWkeyLne2SiDwvY29ycF9uYW1lPgogICAgICAgIDxjb3JwX2VuZ19uYW1lPlNBTVlBTkcgRk9PRFMgQ08uLExURC48L2NvcnBfZW5nX25hbWU+CiAgICAgICAgPHN0b2NrX2NvZGU+MDAzMjMwPC9zdG9ja19jb2RlPgogICAgICAgIDxtb2RpZnlfZGF0ZT4yMDI2MDEwMTwvbW9kaWZ5X2RhdGU+CiAgICA8L2xpc3Q+CiAgICA8bGlzdD4KICAgICAgICA8Y29ycF9jb2RlPjAwOTk5OTkxPC9jb3JwX2NvZGU+CiAgICAgICAgPGNvcnBfbmFtZT7sgrzslpHsi53tkojtjJDrp6Q8L2NvcnBfbmFtZT4KICAgICAgICA8Y29ycF9lbmdfbmFtZT48L2NvcnBfZW5nX25hbWU+CiAgICAgICAgPHN0b2NrX2NvZGU+IDwvc3RvY2tfY29kZT4KICAgICAgICA8bW9kaWZ5X2RhdGU+MjAyNjAxMDE8L21vZGlmeV9kYXRlPgogICAgPC9saXN0PgogICAgPGxpc3Q+CiAgICAgICAgPGNvcnBfY29kZT4wMDEyNjM4MDwvY29ycF9jb2RlPgogICAgICAgIDxjb3JwX25hbWU+7IK87ISx7KCE7J6QPC9jb3JwX25hbWU+CiAgICAgICAgPGNvcnBfZW5nX25hbWU+U0FNU1VORyBFTEVDVFJPTklDUyBDTywuTFREPC9jb3JwX2VuZ19uYW1lPgogICAgICAgIDxzdG9ja19jb2RlPjAwNTkzMDwvc3RvY2tfY29kZT4KICAgICAgICA8bW9kaWZ5X2RhdGU+MjAyNjAxMDE8L21vZGlmeV9kYXRlPgogICAgPC9saXN0PgogICAgPGxpc3Q+CiAgICAgICAgPGNvcnBfY29kZT4wMDk5OTk5MjwvY29ycF9jb2RlPgogICAgICAgIDxjb3JwX25hbWU+7IK87JaR7Iud7ZKI6re466O57KeA7JuQPC9jb3JwX25hbWU+CiAgICAgICAgPGNvcnBfZW5nX25hbWU+PC9jb3JwX2VuZ19uYW1lPgogICAgICAgIDxzdG9ja19jb2RlPiA8L3N0b2NrX2NvZGU+CiAgICAgICAgPG1vZGlmeV9kYXRlPjIwMjYwMTAxPC9tb2RpZnlfZGF0ZT4KICAgIDwvbGlzdD4KPC9yZXN1bHQ+UEsBAhQDFAAAAAAAAkbLXFTgsaEOBAAADgQAAAwAAAAAAAAAAAAAAIABAAAAAENPUlBDT0RFLnhtbFBLBQYAAAAAAQABADoAAAA4BAAAAAA=",
  "base64",
);

function stubFetchZip(buf: Buffer) {
  const fn = vi.fn(async () => new Response(new Uint8Array(buf), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("search_company 회귀 re-21a~g (WO-124)", () => {
  beforeEach(() => {
    process.env.DART_API_KEY = "test-dart-key";
    _resetCorpDirCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-21a: zero-dep zip 해제 — deflate(실제 DART 형식)·stored 모두", () => {
    const xml1 = unzipSingleEntry(ZIP_DEFLATED).toString("utf8");
    const xml2 = unzipSingleEntry(ZIP_STORED).toString("utf8");
    expect(xml1).toContain("<corp_code>00121726</corp_code>");
    expect(xml1).toContain("삼양식품");
    expect(xml2).toBe(xml1); // 두 압축 방식 동일 원문 복원
  });

  it("re-21b: 디렉터리 로드 — 4개사 파싱 + 캐시 (2번째 호출 fetch 0회)", async () => {
    const fetchFn = stubFetchZip(ZIP_DEFLATED);
    const entries = await loadCorpDirectory();
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      corp_code: "00121726",
      corp_name: "삼양식품",
      stock_code: "003230",
    });

    await loadCorpDirectory(); // 캐시 히트
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("re-21c: 상장 우선 + 정확명 우선 정렬 — 삼양식품(상장)이 1순위", async () => {
    stubFetchZip(ZIP_DEFLATED);
    const all = await searchCorpByName("삼양식품", { listed_only: false });
    expect(all.map((e) => e.corp_name)).toEqual([
      "삼양식품", // 상장 + 최단명
      "삼양식품판매", // 비상장, 이름 짧은 순
      "삼양식품그룹지원",
    ]);

    const listedOnly = await searchCorpByName("삼양식품"); // 기본 listed_only=true
    expect(listedOnly).toHaveLength(1);
    expect(listedOnly[0]!.corp_code).toBe("00121726");
  });

  it("re-21d: 도구 응답 — 표준 4필드 + matches + corp_code 사용 안내", async () => {
    stubFetchZip(ZIP_DEFLATED);
    const result = await executeSearchCompany(
      SearchCompanyInputSchema.parse({ query: "삼양식품" }),
    );
    assertStandardResponse(result);
    const data = (result as {
      data: { meta: { match_count: number }; matches: Array<{ corp_code: string; stock_code: string }> };
    }).data;
    expect(data.meta.match_count).toBe(1);
    expect(data.matches[0]).toMatchObject({ corp_code: "00121726", stock_code: "003230" });
  });

  it("re-21e: 0건 → buildNoData + 비상장 재검색 안내 (추측 금지)", async () => {
    stubFetchZip(ZIP_DEFLATED);
    const result = await executeSearchCompany(
      SearchCompanyInputSchema.parse({ query: "없는회사명" }),
    );
    assertStandardResponse(result, { allowNoData: true });
    expect((result as { data: unknown }).data).toBeNull();
    expect((result as { warnings: string[] }).warnings.join()).toContain("listed_only=false");
  });

  it("re-21f: 인증키 오류 — zip 아닌 응답 본문을 그대로 노출 (추측 금지)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"status":"010","message":"등록되지 않은 키"}', { status: 200 })),
    );
    await expect(loadCorpDirectory()).rejects.toThrow(/zip이 아님.*등록되지 않은 키/);
  });

  it("re-21g: 입력 검증 — 1자 query ZodError / listed_only 기본 true", () => {
    expect(() => SearchCompanyInputSchema.parse({ query: "삼" })).toThrow(z.ZodError);
    expect(SearchCompanyInputSchema.parse({ query: "삼양" }).listed_only).toBe(true);
  });
});
