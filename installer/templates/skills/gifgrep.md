---
name: Gifgrep
description: Search and retrieve GIFs for fun responses
triggers: gif,giphy,find gif,search gif,reaction gif,funny gif
command-dispatch: tool
command-tool: gif_search
---

# Gifgrep - GIF Search

Search and retrieve GIFs from Giphy for fun responses and reactions.

## Available Tools

### gif_search
Search for GIFs by keyword.

```json
gif_search {"query": "excited", "limit": 5}
```

Parameters:
- `query`: Search term (e.g., "excited", "thumbs up", "celebration")
- `limit`: Number of results (max 50, default: 5)
- `rating`: Content rating - g, pg, pg-13, r (default: g)

### gif_random
Get a random GIF, optionally filtered by tag.

```json
gif_random {"tag": "celebration"}
```

Parameters:
- `tag`: Optional tag to filter by (e.g., "funny", "cat", "dance")
- `rating`: Content rating (default: g)

### gif_trending
Get currently trending GIFs.

```json
gif_trending {"limit": 10}
```

Parameters:
- `limit`: Number of results (max 50, default: 10)
- `rating`: Content rating (default: g)

## Response Format

Each GIF result includes:
- `id`: Giphy GIF ID
- `title`: GIF title
- `url`: Giphy page URL
- `embed_url`: Embeddable URL
- `images`: Object with different sizes:
  - `original`: Full size GIF
  - `downsized`: Smaller version
  - `preview`: Tiny preview
  - `fixed_height`: 200px height version
  - `fixed_width`: 200px width version

## Example Uses

### Reaction GIF
```json
gif_search {"query": "mind blown"}
```

### Celebration
```json
gif_random {"tag": "party"}
```

### Cat GIF
```json
gif_search {"query": "cat typing", "limit": 3}
```

## Tips

- Use specific search terms for better results
- The `fixed_height` or `fixed_width` URLs are good for embedding
- Random GIFs are great for variety in responses
- Rating "g" is safest for general use
