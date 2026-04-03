export interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'area' | 'candle' | 'tv';
  title?: string;
  /** TradingView symbol, e.g. "TVC:GOLD", "BITSTAMP:BTCUSD" */
  symbol?: string;
  /** TradingView interval: "1","5","15","60","D","W","M" (default "W") */
  interval?: string;
  data: {
    labels: string[];
    values?: number[];
    series?: {
      name: string;
      values: number[];
    }[];
    candles?: Array<{ open: number; high: number; low: number; close: number }>;
  };
}

function isValidChartData(obj: unknown): obj is ChartData {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (!['bar', 'line', 'pie', 'area', 'candle', 'tv'].includes(o.type as string)) return false;

  // TradingView widget: only needs a symbol, no data required
  if (o.type === 'tv') {
    return typeof o.symbol === 'string' && o.symbol.length > 0;
  }

  if (!o.data || typeof o.data !== 'object') return false;
  const d = o.data as Record<string, unknown>;
  if (!Array.isArray(d.labels)) return false;
  if (d.values !== undefined && !Array.isArray(d.values)) return false;
  if (d.series !== undefined && !Array.isArray(d.series)) return false;
  if (d.candles !== undefined && !Array.isArray(d.candles)) return false;
  if (!d.values && !d.series && !d.candles) return false;
  return true;
}

const CHART_PREFIX = '[chart:';

/**
 * Extract [chart:{...}] markers using bracket-balanced parsing.
 * Regex can't handle nested brackets in JSON, so we find the opening
 * `[chart:{` and then scan for the matching closing `}]`.
 */
export function extractChartMarkers(text: string): { cleaned: string; charts: ChartData[] } {
  const charts: ChartData[] = [];
  let cleaned = '';
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf(CHART_PREFIX, cursor);
    if (start === -1) {
      cleaned += text.slice(cursor);
      break;
    }

    // Add text before the marker
    cleaned += text.slice(cursor, start);

    // Find the JSON start (the `{` after `[chart:`)
    const jsonStart = start + CHART_PREFIX.length;
    if (text[jsonStart] !== '{') {
      // Not a valid chart marker, keep the text
      cleaned += CHART_PREFIX;
      cursor = jsonStart;
      continue;
    }

    // Scan for balanced closing `}]`
    let depth = 0;
    let inString = false;
    let escaped = false;
    let jsonEnd = -1;

    for (let i = jsonStart; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth--;
      if (depth === 0 && ch === '}') {
        // Check if followed by `]`
        if (i + 1 < text.length && text[i + 1] === ']') {
          jsonEnd = i + 1; // points to the `]`
          break;
        }
      }
    }

    if (jsonEnd === -1) {
      // No balanced close found, keep the text as-is
      cleaned += CHART_PREFIX;
      cursor = jsonStart;
      continue;
    }

    const jsonStr = text.slice(jsonStart, jsonEnd);
    cursor = jsonEnd + 1; // skip past the `]`

    try {
      const parsed = JSON.parse(jsonStr);
      if (isValidChartData(parsed)) {
        charts.push(parsed);
      }
    } catch { /* skip malformed */ }
  }

  return { cleaned: cleaned.trim(), charts };
}
