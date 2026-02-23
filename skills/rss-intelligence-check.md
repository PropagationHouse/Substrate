---
name: RSS Intelligence Check
description: Scans curated RSS feeds from the intelligence_feed.md, fetches the latest updates, and summarizes them for the studio.
triggers: rss check,update intelligence feed,check feeds,what's new in the substrate,garden the feeds
---

# RSS Intelligence Check

This skill allows the agent to systematically monitor the curated RSS feeds defined in the `intelligence_feed.md` file. It ensures the "Gardener" role is fulfilled by keeping the studio's intelligence substrate up to date.

## Workflow

1.  **Locate Sources**: Read `C:\Users\Bl0ck\ph\Intelligence_Feed.md` to extract the list of RSS URLs.
2.  **Fetch Updates**: Use `web_fetch` or `exec` with `curl` to retrieve the latest XML/Atom content from the feeds.
3.  **Parse & Filter**: Extract the most recent 5-7 items from each feed, focusing on titles, links, and detailed summaries.
4.  **Synthesize**: Cross-reference updates with the "Symbiosis Protocol" to identify high-signal information relevant to Propagation House (Spatial OS, AI, Branding, etc.).
5.  **Log & Report**: Update the `Intelligence_Feed.md` with a "Daily Briefing" section. 
    - **[The Deep Dive]**: Each item must include a direct source link, technical granularity (specs, players), and an analysis of its broader industry impact beyond the studio.
    - **[The Signal]**: A synthesis of how these updates interact, framed as a discussion or article opener for the broader tech/design community.
    - **[The Feature Article]**: A comprehensive, publishable article (approx. 3-minute read / 600-800 words) that weaves the day's intelligence into a cohesive narrative. This should be authoritative, avoiding "suggestions" and instead presenting a strong perspective on the current state of the substrate.
    - **Storage**: Save the final output to the Obsidian vault at `C:\Users\Bl0ck\ph`.
    - **Verbal Summary**: Provide a concise overview to the user.**

## Example Triggers

- "Check the feeds and see if anything shifted today."
- "Update the intelligence feed."
- "What's the latest pulse from our substrate?"
- "Garden the RSS list."

## Implementation Note
When parsing XML, prioritize the `<item>` (RSS) or `<entry>` (Atom) tags. If a feed is blocked or fails, log the error and move to the next. Focus on "High Signal" over "High Volume." Ensure the output format in `Intelligence_Feed.md` remains consistent but enriched with more data and links. Always use `C:\Users\Bl0ck\ph\Intelligence_Feed.md` as the canonical file.