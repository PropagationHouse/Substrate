import { useRef, useCallback, useEffect } from 'react';

interface TabCompletionState {
  /** The original word fragment the user typed before any completion */
  originalWord: string;
  /** Start index of the word being completed in the full input */
  wordStart: number;
  /** End index of the word being completed (before completion) */
  wordEnd: number;
  /** Matched candidates for the current fragment */
  matches: string[];
  /** Current index in the matches array */
  cycleIndex: number;
  /** Full input text before the first completion, for Escape restore */
  originalText: string;
  /** Cursor position before the first completion */
  originalCursor: number;
}

/**
 * Terminal-style tab completion for session names in the chat input.
 *
 * Returns an `onKeyDown` handler that intercepts Tab/Shift+Tab
 * and cycles through matching session labels, plus Escape to cancel.
 * The caller must provide a live list of completable labels and a ref
 * to the textarea element.
 *
 * **Input control model:** This hook writes to the textarea via direct
 * DOM assignment (`input.value = …`) by default. This is safe *only*
 * when the textarea is uncontrolled (no React `value` prop). If you
 * ever switch InputBar to a controlled textarea, pass a `setValue`
 * callback to avoid desyncing React state from the DOM.
 */
export function useTabCompletion(
  getLabels: () => string[],
  inputRef: React.RefObject<HTMLTextAreaElement | null>,
  /**
   * Optional callback to set the input value (for controlled inputs).
   * If not provided, the textarea is assumed to be uncontrolled (ref-based),
   * and `input.value` is set directly — which is safe when no `value` prop
   * is bound to the element.
   */
  setValue?: (value: string) => void,
) {
  const stateRef = useRef<TabCompletionState | null>(null);

  /**
   * Guard flag: while we're applying a completion, the synthetic `input`
   * event we dispatch (for auto-resize) will bubble up and trigger the
   * caller's onInput → reset(). This flag prevents that from nuking
   * the completion state mid-cycle.
   */
  const applyingRef = useRef(false);

  // Keep a stable ref to the latest getLabels to avoid stale closures
  // in the memoized handleKeyDown callback.
  const getLabelsRef = useRef(getLabels);
  useEffect(() => {
    getLabelsRef.current = getLabels;
  }, [getLabels]);

  // Invalidate completion state when labels change (e.g., sessions
  // added/removed mid-completion cycle) so we don't show stale matches.
  useEffect(() => {
    stateRef.current = null;
  }, [getLabels]);

  /** Reset completion state (called on any non-Tab keypress / input change) */
  const reset = useCallback(() => {
    if (applyingRef.current) return; // ignore resets caused by our own synthetic input event
    stateRef.current = null;
  }, []);

  /**
   * Key-down handler.  Returns `true` if the event was consumed
   * (Tab completion or Escape cancel happened), `false` otherwise.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      // ── Escape: cancel completion & restore original text ─────
      if (e.key === 'Escape' && stateRef.current) {
        e.preventDefault();
        const input = inputRef.current;
        const st = stateRef.current;
        if (input) {
          applyingRef.current = true;
          applyValue(input, st.originalText, setValue);
          input.setSelectionRange(st.originalCursor, st.originalCursor);
          // Trigger resize (InputBar auto-sizes on input)
          input.dispatchEvent(new Event('input', { bubbles: true }));
          applyingRef.current = false;
        }
        stateRef.current = null;
        return true;
      }

      if (e.key !== 'Tab') {
        // Any other key resets completion state
        reset();
        return false;
      }

      const input = inputRef.current;
      if (!input) return false;

      // Don't complete when text is selected — replacing a selection
      // with a completion candidate would be surprising.
      if (input.selectionStart !== input.selectionEnd) return false;

      const text = input.value;
      const cursor = input.selectionStart ?? text.length;

      const reverse = e.shiftKey;

      // ── First Tab press: compute matches ──────────────────────
      if (!stateRef.current) {
        // Find the word the cursor is on / right after
        let wordStart = cursor;
        while (wordStart > 0 && text[wordStart - 1] !== ' ' && text[wordStart - 1] !== '\n') {
          wordStart--;
        }
        let wordEnd = cursor;
        // Optionally extend to end of current word (if cursor is mid-word)
        while (wordEnd < text.length && text[wordEnd] !== ' ' && text[wordEnd] !== '\n') {
          wordEnd++;
        }

        const fragment = text.slice(wordStart, cursor).toLowerCase();
        if (!fragment) return false; // nothing to complete

        const labels = getLabelsRef.current();
        const matches = labels.filter((l) =>
          l.toLowerCase().startsWith(fragment),
        );

        if (matches.length === 0) return false; // no matches → let browser do default

        e.preventDefault();

        stateRef.current = {
          originalWord: fragment,
          wordStart,
          wordEnd,
          matches,
          cycleIndex: 0,
          originalText: text,
          originalCursor: cursor,
        };

        applyingRef.current = true;
        applyCompletion(input, stateRef.current, setValue);
        applyingRef.current = false;
        return true;
      }

      // ── Subsequent Tab presses: cycle through matches ─────────
      e.preventDefault();
      const st = stateRef.current;

      if (reverse) {
        st.cycleIndex =
          (st.cycleIndex - 1 + st.matches.length) % st.matches.length;
      } else {
        st.cycleIndex = (st.cycleIndex + 1) % st.matches.length;
      }

      // Recalculate wordEnd based on previous completion length
      applyingRef.current = true;
      applyCompletion(input, st, setValue);
      applyingRef.current = false;
      return true;
    },
    [inputRef, reset, setValue],
  );

  return { handleKeyDown, reset };
}

// ── helpers ──────────────────────────────────────────────────────

/**
 * Set the textarea value.  Uses the provided `setValue` callback for
 * controlled inputs, or falls back to direct DOM assignment for
 * uncontrolled (ref-based) textareas — which is safe when no React
 * `value` prop is bound to the element.
 */
function applyValue(
  input: HTMLTextAreaElement,
  value: string,
  setValue?: (v: string) => void,
) {
  if (setValue) {
    setValue(value);
  } else {
    // Uncontrolled textarea: direct assignment is safe because
    // InputBar does not bind a `value` prop (it reads via inputRef).
    input.value = value;
  }
}

function applyCompletion(
  input: HTMLTextAreaElement,
  state: TabCompletionState,
  setValue?: (v: string) => void,
) {
  const text = input.value;
  const replacement = state.matches[state.cycleIndex];

  // Build new value: everything before the word + replacement + everything after
  const before = text.slice(0, state.wordStart);
  const after = text.slice(state.wordEnd);
  const newValue = before + replacement + after;

  // Apply
  applyValue(input, newValue, setValue);

  // Update wordEnd so subsequent cycles replace the right range
  state.wordEnd = state.wordStart + replacement.length;

  // Place cursor right after the completed word
  const newCursor = state.wordEnd;
  input.setSelectionRange(newCursor, newCursor);

  // Trigger resize (InputBar auto-sizes on input)
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
