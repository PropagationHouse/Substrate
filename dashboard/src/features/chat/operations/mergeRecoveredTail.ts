import type { ChatMsg } from '@/features/chat/types';

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return hash;
}

function messageSignature(msg: ChatMsg): string {
  const normalizedText = (msg.rawText || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 4000);
  const textHash = hashString(normalizedText).toString(16);
  const tsBucket = Math.floor(msg.timestamp.getTime() / 30_000);
  const flags = [
    msg.isThinking ? 'thinking' : '',
    msg.intermediate ? 'intermediate' : '',
    msg.toolGroup ? `toolGroup:${msg.toolGroup.length}` : '',
    msg.images?.length ? `images:${msg.images.length}` : '',
  ].filter(Boolean).join(',');

  return `${msg.role}|${textHash}|${tsBucket}|${flags}`;
}

function findSuffixPrefixOverlap(existingSigs: string[], recoveredSigs: string[]): number {
  const max = Math.min(existingSigs.length, recoveredSigs.length, 120);
  for (let len = max; len >= 1; len--) {
    let match = true;
    for (let i = 0; i < len; i++) {
      if (existingSigs[existingSigs.length - len + i] !== recoveredSigs[i]) {
        match = false;
        break;
      }
    }
    if (match) return len;
  }
  return 0;
}

/**
 * Find a single-message anchor between existing tail and recovered messages.
 * Searches from the END of the existing array to find the latest match,
 * reducing the risk of hash collisions on short/common messages anchoring
 * at the wrong position.
 */
function findTailAnchor(existingSigs: string[], recoveredSigs: string[]) {
  const tailStart = Math.max(0, existingSigs.length - 160);

  for (let existingIdx = existingSigs.length - 1; existingIdx >= tailStart; existingIdx--) {
    const sig = existingSigs[existingIdx];
    for (let recoveredIdx = 0; recoveredIdx < recoveredSigs.length; recoveredIdx++) {
      if (recoveredSigs[recoveredIdx] === sig) {
        return { existingIdx, recoveredIdx };
      }
    }
  }

  return null;
}

/**
 * Merge a recovered history tail into the current transcript without replacing
 * unaffected prefix messages.
 */
export function mergeRecoveredTail(existing: ChatMsg[], recovered: ChatMsg[]): ChatMsg[] {
  if (recovered.length === 0) return existing;
  if (existing.length === 0) return recovered;

  const existingSigs = existing.map(messageSignature);
  const recoveredSigs = recovered.map(messageSignature);

  let merged: ChatMsg[];

  // Fast path: recovered starts where existing tail ends.
  const overlap = findSuffixPrefixOverlap(existingSigs, recoveredSigs);
  if (overlap > 0) {
    merged = [...existing, ...recovered.slice(overlap)];
  } else {
    // Anchor path: find a matching point in the existing tail and replace only suffix.
    const anchor = findTailAnchor(existingSigs, recoveredSigs);
    if (anchor) {
      const preservedPrefix = existing.slice(0, anchor.existingIdx);
      const patchedTail = recovered.slice(anchor.recoveredIdx);
      merged = [...preservedPrefix, ...patchedTail];
    } else {
      // Last resort: no overlap/anchor detected, prefer authoritative recovered tail.
      merged = recovered;
    }
  }

  // ── Preserve locally-created thinking bubbles ──
  // Thinking messages only exist client-side (never persisted to gateway).
  // Re-insert any that were lost during the merge.
  const mergedSigSet = new Set(merged.map(messageSignature));
  const lostThinking = existing.filter(
    m => m.isThinking && !mergedSigSet.has(messageSignature(m))
  );
  if (lostThinking.length > 0) {
    // Insert each thinking bubble right before the first message that came after
    // it in the original existing array (preserves chronological order).
    for (const thinkMsg of lostThinking) {
      const origIdx = existing.indexOf(thinkMsg);
      // Find the next non-thinking message after it in existing
      let anchorSig: string | null = null;
      for (let j = origIdx + 1; j < existing.length; j++) {
        if (!existing[j].isThinking) {
          anchorSig = messageSignature(existing[j]);
          break;
        }
      }
      if (anchorSig) {
        const insertAt = merged.findIndex(m => messageSignature(m) === anchorSig);
        if (insertAt >= 0) {
          merged.splice(insertAt, 0, thinkMsg);
          continue;
        }
      }
      // Fallback: append before the last assistant message or at end
      merged.push(thinkMsg);
    }
  }

  return merged;
}
