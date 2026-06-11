# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning by [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- ⏳ DS005 주요사항보고서 도구 2종 — CB/BW 발행결정 + 유상·무상증자 결정 (발행가·전환가액·증자비율 정형 조회)
- ⏳ Cloudflare proxy + ALLOWED_HOSTS 활성화 (uptime 7일 후)
- ⏳ 시너지 도구 정밀화 (lag 자동 탐지, 3 도구)
- ⏳ Anthropic MCP Directory 제출 (후순위)

## [1.4.0] — 2026-06-11 🔎 v1.4 — search_company = 19 도구 (corp_code 자동 해결)

### Added
- **`search_company` (19번째 도구)** — 회사명 부분일치 → DART corp_code 검색.
  corpCode.xml 전체(~10만 기업) 서버 1회 다운로드 + **24h 캐시**, 상장 우선·정확명 우선 정렬.
  KNOWN_COMPANIES 30개 한계 해소 — 어떤 상장사든 에이전트 체인이 끊기지 않음.
- `unzipSingleEntry` — **zero-dep zip 해제** (zlib.inflateRawSync, deflate/stored). 외부 의존성 0 유지.
- `tests/regression/16-search_company.test.ts` (re-21a~g) — Python zipfile로 생성한 실물 zip을 base64 내장 (파서·생성기 독립).

### Changed
- `get_disclosure`: KNOWN_COMPANIES 미등재 시 search_company 안내 warning 추가 — 도구 간 체인 연결 (WO-124).

## [1.3.0] — 2026-06-11 🏘️ v1.3 — track_apartment_trend = 18 도구 + RTMS 파서 근본 수정

### Added
- **`track_apartment_trend` (18번째 도구)** — 단지 실거래 추세 시계열.
  월별 순회(호출 사이 250ms) → 단지명 부분일치(공백 정규화) → 면적대(㎡ 절사)별
  {거래건수·평균가·최저/최고가} + 직전월 대비 변동률(%). `property_type` apt|villa|house.
  RTMS 신고기한 30일 → 최근 1~2개월 불완전 warning 의무. 기간 상한 24개월.
- `tests/regression/14-track_apartment_trend.test.ts` (re-19a~p) + `15-rtms-xml-parsing.test.ts` (re-20a~d, **fly ssh 실측 XML 픽스처**).

### Fixed
- **WO-122 — "100건 전부 빈 값" 근본 수정**: `<item>` 래퍼가 필드 정규식에 자기-매치되어
  내부 전체를 삼키던 파서 버그. 래퍼 제거 후 내부만 파싱 + 신 영문 필드(`aptNm`/`mhouseNm`) 매핑.
  (WO-120의 "한글 태그" 진단은 오진 — 실측 응답은 전부 영문 태그.)
- **WO-121 — 세션 자동 복구**: 서버 재시작으로 소실된 세션에 400 대신 **404** 반환 (MCP 스펙) →
  클라이언트 자동 re-initialize. 배포 때마다 전 클라이언트가 수동 재연결하던 결함 영구 해소.
  활성 세션 타이머 sliding 갱신.

### Changed
- **WO-123 — 견고화**: RTMS 단건 8s 타임아웃 + 5xx/네트워크 1회 재시도(400ms backoff) /
  `numOfRows` 100→**1000** (월 100건 초과 시군구 누락 해소) /
  track 40s deadline — 초과 시 수집 prefix만 집계 + 미수집 구간 warning (0건 위장 금지).

## [1.2.0] — 2026-05-31 🌏 v1.2 — 전국 250개 시군구 + 정부 RTMS 수준 정렬

### Added
- **KNOWN_REGIONS 전국 250개 시군구 등록** (10 → 250) — 서울 25 + 광역시 51 + 세종 1 + 경기 42 + 강원 18 + 충북 14 + 충남 16 + 전북 15 + 전남 22 + 경북 23 + 경남 22 + 제주 2
- 부동산 거래 응답에 **`jibun`(지번) + `floor`(층) 공개** — 정부 RTMS rt.molit.go.kr 공개 수준과 동일
- `src/lib/operational-metrics.ts` — 운영 인프라 모듈 (기본 비활성, ENABLED=false)
- `migrations/001_operational_metrics.sql` — Supabase kfin_tool_calls 테이블

### Changed
- **validateRegionCode**: KNOWN_REGIONS 강제 검증 제거 → 5자리 형식만 검증. 미등록 코드는 RTMS API 위임 → 빈 응답 시 INFO-200 fallback.
- 부동산 sanitize 정책: "정부보다 1단계 보수적" → **"정부 RTMS 공개 정책 준수"** (지번·층 공개, 동·호 마스킹)
- PRIVACY v1.1 → v1.2: 네이버 컨셉 (수집 가능 카테고리 명시)
- README "무엇을 할 수 있나요" 사용자 친화 도입부 추가, 17 도구 표

### Security
- **Express trust proxy 핫픽스**: `app.set('trust proxy', 1)` — Fly.io 프록시 신뢰 → express-rate-limit이 실제 사용자 IP 식별 → 분산 공격 방어

### Internal
- WO-110: README v1.1 + trust proxy + PRIVACY 통합 핫픽스
- WO-111: KNOWN_TICKERS 30건 데이터 추가
- WO-112: DART DS004 2 도구 추가 (지분공시)
- WO-113: DNS rebinding 코드 검증 (활성화 deferred)
- WO-116: 부동산 sanitize 정부 수준 정렬 (jibun·floor 공개)
- WO-117: 운영 메트릭 인프라 모듈 (Supabase 통합 코드, 기본 비활성)
- WO-118: KNOWN_REGIONS 전국 250개 확장 (제주 50110 포함 모든 시군구)
- WO-119: v1.2.0 정식 출시 (버전 통일)

## [1.1.0] — 2026-05-31 🆕 v1.1 — DART DS004 지분공시 2 도구 추가 = 17 도구

### Added
- **2 new DART DS004 tools** (자본시장법 §147~149 *조회만*, 해석·예측 X):
  - `get_major_holdings` — 대량보유 상황 보고 (5% 룰, §147)
  - `get_executive_holdings` — 임원·주요주주 소유 보고 (§148·149)
- `KNOWN_TICKERS` 30건 등록 — KOSPI 20 + KOSDAQ 10 (KRX 공시 검증)
- `KNOWN_COMPANIES` 2건 등록 — 삼성전자·SK하이닉스 (DART corp_code 검증)
- `findCorpCodeByTicker` 헬퍼 — ticker → corp_code 매핑
- `src/lib/dart.ts`: `fetchDartMajorStock` + `fetchDartExecutiveStock` (캐시 1시간, INFO-200 패턴)

### Changed
- README: 15 도구 → **17 도구** 표 갱신. "무엇을 할 수 있나요" 사용자 친화 도입부 추가.
- README: 1일 마라톤 + 로드맵 12주 표 제거 (대중성 ↑).
- PRIVACY: 네이버 컨셉 — "수집 안 함" 약속 제거, "수집 가능 카테고리" 명시.
- src/http.ts: `app.set('trust proxy', 1)` 추가 — Fly.io 프록시 신뢰 → 실제 사용자 IP 식별.

### Security
- **Express trust proxy 핫픽스**: express-rate-limit이 X-Forwarded-For 정확 인식 → 분산 공격 방어.

### Internal
- WO-110: README + trust proxy + PRIVACY 통합 핫픽스
- WO-111: KNOWN_TICKERS 30건 데이터 추가
- WO-112: DART DS004 2 도구 추가
- WO-113: DNS rebinding 보호 코드 검증 (활성화 deferred)

## [0.3.0] — 2026-05-25 🎉 v3.0 Stock 6 Tools + 2 Synergy = 15 Tools Complete

### Added
- **Stock 6 tools** (v3.0 complete):
  - `get_disclosure` — DART 공시 목록 (DS001+DS002+DS005, KNOWN_COMPANIES 매핑)
  - `get_financials` — DART 재무제표 (DS003, 단일·연결, XBRL 원문)
  - `get_stock_price` — KRX 일별 주가 (공공데이터포털 경유, data_as_of_date 필수)
  - `get_market_index` — KRX KOSPI/KOSDAQ/KOSPI200 일별 지수
  - ⭐ `correlate_macro_stock` — ECOS × KRX synergy (Pearson + lag + 주가 월간 변환, MANDATORY_NOTES 4건)
  - ⭐⭐ `correlate_stock_realestate` — **Korea-unique** KRX × R-ONE synergy (narrative + MANDATORY_NOTES 5건)
- `src/lib/dart.ts` (DART OpenAPI client, 4 endpoints + sanitize + cache)
- `src/lib/krx.ts` (KRX OpenAPI client via data.go.kr, 2 endpoints + sanitize realtime keywords)
- `src/lib/stock-dictionaries.ts` (KnownCompanyMeta + KnownTickerMeta interface, 데이터는 API Key 발급 후 채움)
- Regression tests: 19 new scenarios (st-01~14) across 7 new test files
- `wiki/korea-finance-mcp/v3-roadmap-detailed.md` (5 Phase + 14 step decomposition)

### Changed
- TOOLS array: 9 → **15 tools** (src/index.ts + src/http.ts both)
- README: 9 → 15 tools breakdown + synergy tool emphasis
- Total regression scenarios: 71 → 90

### Permanent Exclusions Reconfirmed (Capital Markets Act)
- ❌ `place_order` / `recommend_stocks` / `predict_price` / `get_target_price`
- ❌ `optimize_portfolio` / `manage_portfolio` / `get_orderbook` (realtime)

## [0.2.0] — 2026-05-25 🏘️ v2.0 Real Estate + 🏆 Cowork Compatible

## [0.2.0] — 2026-05-25 🏘️ v2.0 Real Estate + 🏆 Cowork Compatible

### Added
- **Real Estate 4 tools** (v2.0 complete):
  - `get_realestate_price` — Korea Ministry of Land RTMS (apt/villa/house)
  - `get_housing_index` — Korea Real Estate Board R-ONE monthly index
  - `get_jeonse_ratio` — Korea-specific jeonse-to-sale ratio
  - ⭐ `correlate_macro_realestate` — Pearson correlation + lag (Korea-unique synergy)
- **WO-069**: Stateful MCP transport (`StreamableHTTPServerTransport`) — Cowork·Claude Desktop·MCP Inspector·Cursor 호환
- **WO-070**: ECOS multi-item handling — `KnownIndicatorMeta` interface (multi_item/default_item_code1/expected_range)
- Tool annotations on all 9 tools (Anthropic Connectors Directory required)
- `PRIVACY.md` (anonymized statistics only, 90-day retention)
- `SECURITY.md` (vulnerability reporting + response SLA)
- `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1)
- Fly.io deployment (NRT region, auto_stop_machines)

### Changed
- `src/http.ts`: `app.all('/mcp')` → `app.post/get/delete('/mcp')` 3-route split with session map
- `KNOWN_INDICATORS` 722Y001: `unit "%" → "연%"`, `cycle "D" → "M"` (WO-070 actual ECOS UNIT_NAME)
- README: added "external use not recommended (1-person operated)" warning + security item separation

### Fixed
- **WO-066**: `RTMSDataSvcAptTradeDev` → `RTMSDataSvcAptTrade` (production endpoint)
- **WO-076**: regression #1 hotfix (search_indicator.test.ts unit/cycle assertion)

### Security
- All API keys via `.env` + Fly.io secrets (5-layer defense verified)
- `git log -S "ECOS_API_KEY="` clean (no value leak in history)
- HTTPS enforced (Fly.io default)
- Stateful session UUIDs (cryptographically random)

## [0.1.0] — 2026-04-28 ~ 2026-05-15 🎉 v1.0 Macro 5/5 Complete

### Added
- **Macro 5 tools** (v1.0 complete):
  - `get_indicator` — Single ECOS indicator current value
  - `search_indicator` — Static dictionary lookup (anti-hallucination)
  - `get_timeseries` — Time series query
  - `compare_indicators` — Multi-indicator comparison (2~5)
  - `get_dashboard` — Curated KPI snapshot
- 71 regression tests + 5 e2e tests (real ECOS API)
- `KNOWN_INDICATORS` static dictionary (4 entries verified via ECOS StatisticTableList)
- CONTRIBUTING.md §8 14-step code-entry checklist
- Twin-repo strategy (Private + Public switch on D-day)
- 6-layer safety net (code throw + assertStandardResponse + regression + CI guard×2 + pre-push hook + e2e)
- Pre-locked decisions (real estate / stock data policy)

### Security
- `.gitignore` 4-pattern protection (`.env` / `.env.local` / `.env.*.local` / `*.env`)
- STANDARD_DISCLAIMER auto-attachment (all responses)
- Capital Markets Act compliance: 7 tools permanently excluded

---

[Unreleased]: https://github.com/emceeKim/korea-finance-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/emceeKim/korea-finance-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/emceeKim/korea-finance-mcp/releases/tag/v0.1.0
