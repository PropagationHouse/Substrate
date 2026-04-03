import { useRef, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'substrate-input-history';
const MAX_ENTRIES = 100;

/**
 * Terminal-style input history with localStorage persistence.
 *
 * Manages a stack of previously sent messages (newest first).
 * ArrowUp/Down navigate the stack; the current draft is saved
 * when navigation begins and restored when moving past the newest entry.
 *
 * History is persisted to `localStorage` under `substrate-input-history`
 * (max 100 entries). Duplicate consecutive entries are suppressed.
 */
export function useInputHistory() {
  const historyRef = useRef<string[]>([]);
  const indexRef = useRef(-1); // -1 = not navigating
  const draftRef = useRef('');

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          historyRef.current = parsed
            .filter((v: unknown) => typeof v === 'string')
            .slice(0, MAX_ENTRIES);
        }
      }
    } catch {
      // Corrupt data — start fresh
    }
  }, []);

  const persist = useCallback(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(historyRef.current),
      );
    } catch {
      // localStorage full or unavailable — silently skip
    }
  }, []);

  /**
   * Add a sent message to history. No-op if `text` is empty or
   * identical to the most recent entry.
   */
  const addToHistory = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (
        historyRef.current.length > 0 &&
        historyRef.current[0] === trimmed
      ) {
        return; // suppress duplicate of last entry
      }
      historyRef.current.unshift(trimmed);
      if (historyRef.current.length > MAX_ENTRIES) {
        historyRef.current = historyRef.current.slice(0, MAX_ENTRIES);
      }
      persist();
      // Reset navigation state
      indexRef.current = -1;
      draftRef.current = '';
    },
    [persist],
  );

  /**
   * Move to an older history entry.
   * @param currentValue The current textarea value (saved as draft on first call).
   * @returns The history entry to display, or `null` if already at the oldest.
   */
  const navigateUp = useCallback(
    (currentValue: string): string | null => {
      if (historyRef.current.length === 0) return null;
      if (indexRef.current >= historyRef.current.length - 1) return null;

      // Save draft when entering history mode
      if (indexRef.current === -1) {
        draftRef.current = currentValue;
      }

      indexRef.current++;
      return historyRef.current[indexRef.current];
    },
    [],
  );

  /**
   * Move to a newer history entry or back to the draft.
   * @returns The entry to display, or `null` if not currently navigating.
   */
  const navigateDown = useCallback((): string | null => {
    if (indexRef.current < 0) return null;

    indexRef.current--;

    if (indexRef.current < 0) {
      return draftRef.current; // back to original draft
    }
    return historyRef.current[indexRef.current];
  }, []);

  /** Reset navigation state (e.g. on Escape or after send). */
  const reset = useCallback(() => {
    indexRef.current = -1;
    draftRef.current = '';
  }, []);

  /** Whether we're currently browsing history (index ≥ 0). */
  const isNavigating = useCallback(() => indexRef.current >= 0, []);

  return { addToHistory, navigateUp, navigateDown, reset, isNavigating };
}
