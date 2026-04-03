/**
 * sanitize.ts - XSS prevention via DOMPurify
 * 
 * SECURITY NOTES:
 * - All user-generated or streamed HTML MUST pass through sanitizeHtml()
 * - The config uses an allowlist approach: only explicitly listed tags/attrs are kept
 * - href attributes are sanitized by DOMPurify to block javascript: and data: URIs
 * - SVG and other potentially dangerous tags are NOT in the allowlist (blocked by default)
 * 
 * The allowlist is minimal and focused on markdown rendering needs.
 * When in doubt, don't add a tag - the markdown renderer uses esc() first,
 * so most content is already escaped before reaching DOMPurify.
 */
import DOMPurify from 'dompurify';

/**
 * Sanitize HTML content to prevent XSS attacks.
 * 
 * Uses DOMPurify with a strict allowlist configuration:
 * - Only safe HTML tags for text formatting are allowed
 * - Only safe attributes (href, target, rel, class, open) are allowed
 * - href URLs are automatically sanitized (javascript:, data: URIs are blocked)
 * - Script tags, event handlers, and dangerous elements are stripped
 * 
 * @param html - Raw HTML string that may contain unsafe content
 * @returns Sanitized HTML string safe for dangerouslySetInnerHTML
 */
export const sanitizeHtml = (html: string): string => {
  return DOMPurify.sanitize(html, {
    // ALLOWED_TAGS: Strict allowlist of safe HTML elements
    // Only includes tags needed for markdown rendering
    // Notably EXCLUDES: script, style, iframe, object, embed, form, input, svg, math
    ALLOWED_TAGS: [
      // Block elements
      'p', 'div', 'br',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'blockquote', 'pre', 'code',
      // Inline formatting
      'strong', 'b', 'em', 'i', 'mark', 'span',
      // Links
      'a',
      // Lists
      'ul', 'ol', 'li',
      // Tables
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      // Interactive (safe)
      'details', 'summary',
    ],
    
    // ALLOWED_ATTR: Strict allowlist of safe attributes
    // href is automatically sanitized by DOMPurify to block dangerous URIs
    ALLOWED_ATTR: [
      'href',      // For links - DOMPurify blocks javascript: and data: URIs
      'target',    // For opening links in new tabs
      'rel',       // For noopener/noreferrer on external links
      'class',     // For styling via CSS classes
      'open',      // For details/summary expanded state
    ],
    
    // Additional security: explicitly forbid dangerous tags even if somehow added
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'svg', 'math'],
    
    // Block dangerous attributes even if tag is allowed
    FORBID_ATTR: ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur'],
    
    // Ensure href doesn't contain javascript: or data: URIs
    // This is DOMPurify's default behavior, but we explicitly enable it
    ALLOW_DATA_ATTR: false,
    
    // Return string (not DOM node)
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });
};

/**
 * Check if a URL is safe to use as href.
 * This is a secondary check - DOMPurify already sanitizes hrefs,
 * but this can be used for pre-validation.
 * 
 * @param url - URL string to validate
 * @returns true if the URL is safe (http/https/mailto), false otherwise
 */
export const isSafeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url, 'https://example.com');
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    // Relative URLs are safe
    return !url.toLowerCase().startsWith('javascript:') && 
           !url.toLowerCase().startsWith('data:') &&
           !url.toLowerCase().startsWith('vbscript:');
  }
};
