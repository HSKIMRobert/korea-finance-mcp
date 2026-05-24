# korea-finance-mcp

**한국 금융 MCP (Model Context Protocol)** — ECOS · 부동산 · DART · KRX 통합

> AI 금융 분석을 위한 한국 표준 MCP 서버. 류주임 법령 MCP 패턴 + cfdude/mcp-fred 패턴 결합.
> ⚠️ **현재 v0.0 (Private)** — 1주차 v0.1 출시 작업 중. v1.0(4주차)에 Public 전환 예정.

## 한 줄 정의

ETF Insight의 "내부 두뇌"이자 한국 AI 금융 분석의 "외부 표준" — 12주 로드맵으로 거시 → 부동산 → 주식 통합.

## 로드맵 (12주)

| 단계 | 주차 | 버전 | 산출 | 도구 누적 |
|---|---|---|---|---|
| 거시 (ECOS) | 1~4 | v0.1 → v1.0 | 기준금리·환율·CPI·M2·GDP 등 6만+ 시계열 | 5 |
| 부동산 | 5~8 | v1.1 → v2.0 | 국토부 실거래가·한국부동산원·전세가율 + 금리↔집값 상관관계 | 9 |
| 주식 | 9~12 | v2.1 → v3.0 | DART·KRX + 거시↔주가·주식↔부동산 상관관계 | 15 |

## 기술 스택

- **언어**: TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **런타임**: Node.js
- **배포**: Fly.io
- **CI/CD**: GitHub Actions
- **검증**: Zod
- **데이터 누적**: Supabase (ETF Insight 공유)

## 데이터 소스 (공공 API만)

- 한국은행 ECOS — https://ecos.bok.or.kr/api/
- 국토교통부 실거래가 — https://www.data.go.kr
- 한국부동산원 R-ONE — https://www.r-one.co.kr/
- DART OpenDART — https://opendart.fss.or.kr/
- KRX — http://data.krx.co.kr/

## 라이선스

[MIT License](LICENSE) — Copyright (c) 2026 MC AI Labs

## ⚠️ 면책조항 (Disclaimer)

본 정보는 **데이터 조회 서비스**이며, **투자 자문이나 권유가 아닙니다**.
모든 투자 판단과 그에 따른 손익은 **사용자 본인의 책임**입니다.
공식 사이트에서 최종 확인을 권장합니다.

본 도구는 자본시장법상 투자중개·투자자문·유사투자자문 어느 영역에도 해당하지 않으며,
단순 공공 데이터 조회 및 통계 분석만 제공합니다.

## 운영 원칙 (양보 불가)

1. **법적 회색지대 절대 진입 금지** — 주문·추천·예측·목표주가 도구 없음
2. **환각 방지** — 모든 응답에 출처 + 기준일 표기, "아마도/보통은" 금지, 데이터 없으면 "데이터 없음"
3. **회귀 테스트 30개** — 매 배포 자동 실행, 환각 1건 발생 시 즉시 롤백
4. **도구는 빼는 결정이 우선** — 진입장벽 30개+ 명시적 배제

## 운영자

**MC AI Labs** (1인 기업) — 유니콘 1인 기업 목표
- 본 프로젝트는 ETF Insight(웹 서비스)와 시너지 운영
- 핸드오프 문서: `wiki/projects/korea-finance-mcp/handoff.md` (mywiki 저장소)

---

*Status*: Private repo · v0.0 · 2026-05-25 셋업 시작
