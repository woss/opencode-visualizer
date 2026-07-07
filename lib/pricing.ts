export interface ModelPrice {
  id: string;
  name: string;
  inputPer1M: number | null; // null = not available
  outputPer1M: number | null;
  cacheReadPer1M: number | null;
  cacheWritePer1M: number | null;
}

export interface CostProjection {
  model: string;
  inputCost: number | null;
  outputCost: number | null;
  cacheCost: number | null;
  projectedTotal: number | null;
  vsActual: string | null; // e.g. "1.4x", "N/A (free)"
}

/** Zen pricing per 1M tokens. null means the price is not available. */
export const ZEN_PRICING: ModelPrice[] = [
  {
    id: "big-pickle",
    name: "Big Pickle",
    inputPer1M: 0,
    outputPer1M: 0,
    cacheReadPer1M: 0,
    cacheWritePer1M: null,
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    inputPer1M: 0.14,
    outputPer1M: 0.28,
    cacheReadPer1M: 0.028,
    cacheWritePer1M: null,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    inputPer1M: 1.74,
    outputPer1M: 3.48,
    cacheReadPer1M: 0.145,
    cacheWritePer1M: null,
  },
  {
    id: "minimax-m3",
    name: "MiniMax M3",
    inputPer1M: 0.30,
    outputPer1M: 1.20,
    cacheReadPer1M: 0.06,
    cacheWritePer1M: null,
  },
  {
    id: "minimax-m2.7",
    name: "MiniMax M2.7",
    inputPer1M: 0.30,
    outputPer1M: 1.20,
    cacheReadPer1M: 0.06,
    cacheWritePer1M: null,
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    inputPer1M: 0.95,
    outputPer1M: 4.00,
    cacheReadPer1M: 0.16,
    cacheWritePer1M: null,
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    inputPer1M: 0.95,
    outputPer1M: 4.00,
    cacheReadPer1M: 0.19,
    cacheWritePer1M: null,
  },
  {
    id: "qwen3.7-plus",
    name: "Qwen3.7 Plus",
    inputPer1M: 0.40,
    outputPer1M: 1.60,
    cacheReadPer1M: 0.04,
    cacheWritePer1M: 0.50,
  },
  {
    id: "qwen3.7-max",
    name: "Qwen3.7 Max",
    inputPer1M: 2.50,
    outputPer1M: 7.50,
    cacheReadPer1M: 0.50,
    cacheWritePer1M: 3.125,
  },
  {
    id: "grok-build-0.1",
    name: "Grok Build 0.1",
    inputPer1M: 1.00,
    outputPer1M: 2.00,
    cacheReadPer1M: 0.20,
    cacheWritePer1M: null,
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    inputPer1M: 3.00,
    outputPer1M: 15.00,
    cacheReadPer1M: 0.30,
    cacheWritePer1M: 3.75,
  },
  {
    id: "claude-opus-4.8",
    name: "Claude Opus 4.8",
    inputPer1M: 5.00,
    outputPer1M: 25.00,
    cacheReadPer1M: 0.50,
    cacheWritePer1M: 6.25,
  },
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    inputPer1M: 10.00,
    outputPer1M: 50.00,
    cacheReadPer1M: null,
    cacheWritePer1M: null,
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    inputPer1M: 1.50,
    outputPer1M: 9.00,
    cacheReadPer1M: 0.15,
    cacheWritePer1M: null,
  },
  {
    id: "glm-5-2-0106",
    name: "GLM-5-2-0106",
    inputPer1M: 1.40,
    outputPer1M: 4.40,
    cacheReadPer1M: 0.26,
    cacheWritePer1M: 0.00,
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    inputPer1M: 5.00,
    outputPer1M: 30.00,
    cacheReadPer1M: 0.50,
    cacheWritePer1M: null,
  },
];

/**
 * Compute projected costs across all models.
 * actual_cost of 0 means the project was free (Big Pickle).
 */
export function computeProjections(
  tokensInput: number,
  tokensOutput: number,
  tokensCacheRead: number,
  tokensCacheWrite: number,
  actualCost: number,
): CostProjection[] {
  const inputM = tokensInput / 1_000_000;
  const outputM = tokensOutput / 1_000_000;
  const cacheReadM = tokensCacheRead / 1_000_000;
  const cacheWriteM = tokensCacheWrite / 1_000_000;

  const results: CostProjection[] = [];

  // Actual cost row first
  const actualLabel = actualCost === 0 ? "Actual (Big Pickle)" : "Actual";
  results.push({
    model: actualLabel,
    inputCost: null,
    outputCost: null,
    cacheCost: null,
    projectedTotal: actualCost,
    vsActual: null,
  });

  for (const p of ZEN_PRICING) {
    const inputCost = p.inputPer1M !== null
      ? +(inputM * p.inputPer1M).toFixed(2)
      : null;
    const outputCost = p.outputPer1M !== null
      ? +(outputM * p.outputPer1M).toFixed(2)
      : null;
    const cacheReadCost = p.cacheReadPer1M !== null
      ? +(cacheReadM * p.cacheReadPer1M).toFixed(2)
      : null;
    const cacheWriteCost = p.cacheWritePer1M !== null
      ? +(cacheWriteM * p.cacheWritePer1M).toFixed(2)
      : null;

    let projectedTotal: number | null = null;
    if (
      inputCost !== null || outputCost !== null || cacheReadCost !== null ||
      cacheWriteCost !== null
    ) {
      projectedTotal = +(
        (inputCost ?? 0) + (outputCost ?? 0) + (cacheReadCost ?? 0) +
        (cacheWriteCost ?? 0)
      ).toFixed(2);
    }

    let vsActual: string | null = null;
    if (projectedTotal !== null && actualCost > 0) {
      const ratio = projectedTotal / actualCost;
      vsActual = ratio.toFixed(1) + "x";
    } else if (projectedTotal !== null && actualCost === 0) {
      if (projectedTotal > 0) {
        vsActual = "N/A (free)";
      } else {
        vsActual = "Free";
      }
    }

    results.push({
      model: p.name,
      inputCost,
      outputCost,
      cacheCost: cacheReadCost !== null || cacheWriteCost !== null
        ? +((cacheReadCost ?? 0) + (cacheWriteCost ?? 0)).toFixed(2)
        : null,
      projectedTotal,
      vsActual,
    });
  }

  // Sort by projectedTotal ascending (cheapest first), keep actual row at top
  const [actualRow, ...rest] = results;
  rest.sort((a, b) => {
    if (a.projectedTotal === null && b.projectedTotal === null) return 0;
    if (a.projectedTotal === null) return 1;
    if (b.projectedTotal === null) return -1;
    return a.projectedTotal - b.projectedTotal;
  });
  return [actualRow, ...rest];
}
