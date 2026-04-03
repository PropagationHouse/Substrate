/**
 * useLimits — Hook for polling Codex and Claude Code rate limits.
 *
 * Fetches limits every 60s with graceful handling of unavailable services.
 */

import { useState, useEffect } from 'react';

// ── Limits types ─────────────────────────────────────────────────────

export interface LimitEntry {
  used_percent: number;
  left_percent: number;
}

export interface CodexLimitEntry extends LimitEntry {
  resets_at: number | null; // epoch seconds
  resets_at_formatted: string | null; // legacy
}

export interface CodexLimits {
  available: boolean;
  five_hour_limit?: CodexLimitEntry;
  weekly_limit?: CodexLimitEntry;
}

export interface ClaudeLimitEntry extends LimitEntry {
  resets_at_epoch: number | null; // epoch ms (normalised server-side)
  resets_at_raw: string;          // original string as fallback
}

export interface ClaudeCodeLimits {
  available: boolean;
  session_limit?: ClaudeLimitEntry;
  weekly_limit?: ClaudeLimitEntry;
}

export interface UseLimitsReturn {
  codexLimits: CodexLimits | null;
  claudeLimits: ClaudeCodeLimits | null;
  codexLastChecked: number | null;
  claudeLastChecked: number | null;
}

const POLL_INTERVAL_MS = 60_000;
const GRACE_MS = 60_000; // keep loading state for 60s before showing "unavailable"

/** Hook to fetch and expose rate-limit / usage data from the gateway. */
export function useLimits(): UseLimitsReturn {
  const [codexLimits, setCodexLimits] = useState<CodexLimits | null>(null);
  const [claudeLimits, setClaudeLimits] = useState<ClaudeCodeLimits | null>(null);
  const [codexLastChecked, setCodexLastChecked] = useState<number | null>(null);
  const [claudeLastChecked, setClaudeLastChecked] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    async function fetchCodex() {
      try {
        const res = await fetch('/api/codex-limits');
        const json = (await res.json()) as CodexLimits;
        if (!cancelled && json.available) {
          setCodexLimits(json);
          setCodexLastChecked(Date.now());
        } else if (!cancelled) {
          setCodexLimits((prev) => prev ?? { available: false });
        }
      } catch {
        if (!cancelled) setCodexLimits((prev) => prev ?? { available: false });
      }
    }

    async function fetchClaude() {
      try {
        const res = await fetch('/api/claude-code-limits');
        const json = (await res.json()) as ClaudeCodeLimits;
        if (!cancelled) {
          if (json.available) {
            setClaudeLimits(json);
            setClaudeLastChecked(Date.now());
          } else {
            setClaudeLimits((prev) => {
              if (prev?.available) return prev; // preserve good data
              if (Date.now() - startedAt < GRACE_MS) return prev; // stay in loading state
              return { available: false };
            });
          }
        }
      } catch {
        if (!cancelled) setClaudeLimits((prev) => prev ?? (Date.now() - startedAt < GRACE_MS ? null : { available: false }));
      }
    }

    fetchCodex();
    fetchClaude();

    const id = setInterval(() => {
      fetchCodex();
      fetchClaude();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { codexLimits, claudeLimits, codexLastChecked, claudeLastChecked };
}
