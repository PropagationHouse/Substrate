/**
 * Detects whether a markdown string contains structured content
 * (code blocks, headers, lists, tables) that benefits from wider rendering.
 *
 * Used to adaptively size assistant message bubbles:
 * - Structured content → wider max-width for readability
 * - Conversational text → prose-width for comfortable reading
 */
export const isStructuredMarkdown = (text: string): boolean => {
  // Fenced code blocks
  if (/```/.test(text)) return true;
  // ATX headers
  if (/^\s*#{1,6}\s+/m.test(text)) return true;
  // Unordered lists
  if (/^\s*[-*+]\s+/m.test(text)) return true;
  // Ordered lists
  if (/^\s*\d+\.\s+/m.test(text)) return true;
  // Tables
  if (/^\s*\|.+\|\s*$/m.test(text)) return true;
  return false;
};
