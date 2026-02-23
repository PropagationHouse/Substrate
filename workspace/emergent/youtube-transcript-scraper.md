# YouTube Transcript Scraper

Manually scrapes a YouTube transcript using browser automation. This is a fallback for when standard transcript retrieval tools fail.

## Triggers
- `scrape youtube transcript`
- `manual transcript retrieval`
- `get transcript from youtube video`

## Workflow

1. **Navigate**: Open the YouTube URL in the browser.
2. **Expand Description**: Click the "More" or "Expand" button in the video description (usually `#expand`).
3. **Open Transcript**: Click the "Show transcript" button (usually `button[aria-label="Show transcript"]`).
4. **Extract**: Execute a script to collect text from the transcript segments (`ytd-transcript-segment-renderer`).

## Implementation Details (Browser Actions)

```javascript
// Step 1: Click Expand
// selector: "#expand"

// Step 2: Click Show Transcript
// selector: "button[aria-label='Show transcript']"

// Step 3: Extract Text
// expression:
Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'))
  .map(el => {
    const timestamp = el.querySelector('.segment-timestamp')?.innerText.trim();
    const text = el.querySelector('.segment-text')?.innerText.trim();
    return `${timestamp} ${text}`;
  })
  .join('\n');
```

## Usage Notes
- Ensure the browser window is active and the page has fully loaded before attempting clicks.
- If the "Show transcript" button is not visible, it may be tucked under a "More actions" menu or simply unavailable for that video.
