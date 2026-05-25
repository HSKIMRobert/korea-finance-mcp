/**
 * korea-finance-mcp — HTTP (Streamable) Server Entry
 *
 * 용도: Fly.io 등 원격 호스팅. Claude Desktop / IDE 등은 stdio (src/index.ts)를 그대로 사용.
 *
 * 통념파괴: stdio→HTTP *전환*이 아니라 **이중 entry**.
 *   - src/index.ts → StdioServerTransport (로컬, Claude Desktop)
 *   - src/http.ts  → StreamableHTTPServerTransport (원격, Fly.io)
 *   회귀 위험 0. 도구 등록 로직은 buildServer()로 공유.
 *
 * @see CONTRIBUTING.md §배포 (v0.4)
 * @see wiki/korea-finance-mcp/work-orders.md WO-027
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { config } from "dotenv";

import { serializeForMcp } from "./lib/response.js";
import {
  getIndicatorTool,
  executeGetIndicator,
  GetIndicatorInputSchema,
} from "./tools/get_indicator.js";
import {
  searchIndicatorTool,
  executeSearchIndicator,
  SearchIndicatorInputSchema,
} from "./tools/search_indicator.js";
import {
  getTimeseriesTool,
  executeGetTimeseries,
  GetTimeseriesInputSchema,
} from "./tools/get_timeseries.js";
import {
  compareIndicatorsTool,
  executeCompareIndicators,
  CompareIndicatorsInputSchema,
} from "./tools/compare_indicators.js";
import {
  getDashboardTool,
  executeGetDashboard,
  GetDashboardInputSchema,
} from "./tools/get_dashboard.js";
import {
  getRealEstatePriceTool,
  executeGetRealEstatePrice,
  GetRealEstatePriceInputSchema,
} from "./tools/get_realestate_price.js";
import {
  getHousingIndexTool,
  executeGetHousingIndex,
  GetHousingIndexInputSchema,
} from "./tools/get_housing_index.js";
import {
  getJeonseRatioTool,
  executeGetJeonseRatio,
  GetJeonseRatioInputSchema,
} from "./tools/get_jeonse_ratio.js";
import {
  correlateMacroRealestateTool,
  executeCorrelateMacroRealestate,
  CorrelateMacroRealestateInputSchema,
} from "./tools/correlate_macro_realestate.js";

// ============================================================
// 환경변수 로드
// ============================================================
config();

// ============================================================
// 도구 레지스트리 — src/index.ts와 동일 (의도적 중복, v0.5에서 lib/registry.ts로 분리 예정)
// ============================================================
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (input: unknown) => Promise<unknown>;
}

const TOOLS: ToolDefinition[] = [
  {
    name: getIndicatorTool.name,
    description: getIndicatorTool.description,
    inputSchema: getIndicatorTool.inputSchema,
    execute: async (input) =>
      executeGetIndicator(GetIndicatorInputSchema.parse(input)),
  },
  {
    name: searchIndicatorTool.name,
    description: searchIndicatorTool.description,
    inputSchema: searchIndicatorTool.inputSchema,
    execute: async (input) =>
      executeSearchIndicator(SearchIndicatorInputSchema.parse(input)),
  },
  {
    name: getTimeseriesTool.name,
    description: getTimeseriesTool.description,
    inputSchema: getTimeseriesTool.inputSchema,
    execute: async (input) =>
      executeGetTimeseries(GetTimeseriesInputSchema.parse(input)),
  },
  {
    name: compareIndicatorsTool.name,
    description: compareIndicatorsTool.description,
    inputSchema: compareIndicatorsTool.inputSchema,
    execute: async (input) =>
      executeCompareIndicators(CompareIndicatorsInputSchema.parse(input)),
  },
  {
    name: getDashboardTool.name,
    description: getDashboardTool.description,
    inputSchema: getDashboardTool.inputSchema,
    execute: async (input) =>
      executeGetDashboard(GetDashboardInputSchema.parse(input)),
  },
  {
    name: getRealEstatePriceTool.name,
    description: getRealEstatePriceTool.description,
    inputSchema: getRealEstatePriceTool.inputSchema,
    execute: async (input) =>
      executeGetRealEstatePrice(GetRealEstatePriceInputSchema.parse(input)),
  },
  {
    name: getHousingIndexTool.name,
    description: getHousingIndexTool.description,
    inputSchema: getHousingIndexTool.inputSchema,
    execute: async (input) =>
      executeGetHousingIndex(GetHousingIndexInputSchema.parse(input)),
  },
  {
    name: getJeonseRatioTool.name,
    description: getJeonseRatioTool.description,
    inputSchema: getJeonseRatioTool.inputSchema,
    execute: async (input) =>
      executeGetJeonseRatio(GetJeonseRatioInputSchema.parse(input)),
  },
  {
    name: correlateMacroRealestateTool.name,
    description: correlateMacroRealestateTool.description,
    inputSchema: correlateMacroRealestateTool.inputSchema,
    execute: async (input) =>
      executeCorrelateMacroRealestate(CorrelateMacroRealestateInputSchema.parse(input)),
  },
];

// ============================================================
// MCP Server 빌더 (요청마다 신규 인스턴스 — stateless 모드)
// ============================================================
function buildServer(): Server {
  const server = new Server(
    { name: "korea-finance-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      throw new Error(`[mcp] Unknown tool: ${req.params.name}`);
    }
    try {
      const result = await tool.execute(req.params.arguments ?? {});
      return serializeForMcp(result as Parameters<typeof serializeForMcp>[0]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ 도구 실행 오류: ${message}\n\n공식 사이트에서 직접 확인 권장.`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// ============================================================
// Zod → JSON Schema (src/index.ts와 동일)
// ============================================================
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = {
        type: zodTypeName(value),
        description: value.description ?? "",
      };
      if (!value.isOptional()) required.push(key);
    }
    return { type: "object", properties, required };
  }
  return { type: "object" };
}

function zodTypeName(s: z.ZodTypeAny): string {
  if (s instanceof z.ZodString) return "string";
  if (s instanceof z.ZodNumber) return "number";
  if (s instanceof z.ZodBoolean) return "boolean";
  if (s instanceof z.ZodEnum) return "string";
  if (s instanceof z.ZodOptional) return zodTypeName(s.unwrap());
  if (s instanceof z.ZodDefault) return zodTypeName(s.removeDefault());
  return "string";
}

// ============================================================
// Express 핸들러 시그니처 (외부 @types/express 없이 빌드 통과용 최소 타입)
// ============================================================
type ExpressRequest = IncomingMessage & { body?: unknown };
interface ExpressResponse extends ServerResponse {
  status: (code: number) => ExpressResponse;
  json: (body: unknown) => ExpressResponse;
  headersSent: boolean;
}

// ============================================================
// HTTP Bootstrap
// ============================================================
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0"; // Fly.io는 0.0.0.0 필수
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function main(): Promise<void> {
  const app = createMcpExpressApp({
    host: HOST,
    allowedHosts: ALLOWED_HOSTS.length > 0 ? ALLOWED_HOSTS : undefined,
  });

  // 헬스체크 — Fly.io 헬스체크용
  app.get("/healthz", (_req: unknown, res: ExpressResponse) => {
    res.status(200).json({
      status: "ok",
      service: "korea-finance-mcp",
      version: "0.1.0",
      tools: TOOLS.length,
      timestamp: new Date().toISOString(),
    });
  });

  // MCP endpoint — stateless 모드 (요청마다 신규 transport+server)
  app.all("/mcp", async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[http] /mcp error: ${errMsg}\n`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.listen(PORT, HOST, () => {
    process.stderr.write(
      `[korea-finance-mcp:http] v0.1.0 listening on http://${HOST}:${PORT} — ${TOOLS.length} tool(s)\n`,
    );
  });
}

main().catch((err) => {
  process.stderr.write(`[korea-finance-mcp:http] fatal: ${err}\n`);
  process.exit(1);
});
