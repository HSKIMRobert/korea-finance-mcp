/**
 * track_apartment_trend 실 API 수동 검증 (1회용, 회귀 아님)
 *
 * 실행: npx tsx scripts/manual-track-trend.ts
 * 요구: .env의 DATA_GO_KR_API_KEY
 *
 * 검증 포인트:
 * - 강남구(11680) '래미안' 부분일치, 2026-01 ~ 2026-06 (6개월 순회)
 * - 월 순회 rate limit 지연 동작 (호출 5회 × 250ms ≈ 1.25s+)
 * - 최근 1~2개월(202605·202606) 신고기한 warning 발동 확인
 */
import { config } from "dotenv";
config();

import {
  executeTrackApartmentTrend,
  TrackApartmentTrendInputSchema,
} from "../src/tools/track_apartment_trend.js";

const input = TrackApartmentTrendInputSchema.parse({
  region_code: "11680",
  apt_name: "래미안",
  start_period: "202601",
  end_period: "202606",
});

const t0 = Date.now();
executeTrackApartmentTrend(input)
  .then((res) => {
    console.log(JSON.stringify(res, null, 2));
    console.error(`\n[manual-test] OK in ${Date.now() - t0}ms`);
  })
  .catch((err) => {
    console.error("[manual-test] FAIL:", err);
    process.exit(1);
  });
