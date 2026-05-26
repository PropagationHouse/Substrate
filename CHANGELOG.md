# Changelog

All notable changes to Substrate will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.2.18] — 2026-05-26

### Glass Chess, Auto-Continue UX, Workspace Panel & Tooling

#### Added
- **Glass Chess in dashboard** — Crown icon in header bar opens the full Glass Chess app (Stockfish AI, position analysis, learning profile) in a draggable FloatingWindow via iframe on port 5050
- **Chess auto-start** — `proxy_server.py` now auto-launches `workspace/chess_game/app.py` on port 5050 alongside the workbench
- **Workspace panel** — New dashboard feature with Config, Crons, Skills, and Memory tabs for workspace management
- **Research standalone module** — Dedicated research panel and `research_module.js` for independent research workflows
- **OpenCode tool** — New `src/tools/opencode_tool.py` for code generation/editing
- **Patch tool** — New `src/tools/patch_tool.py` for applying code patches
- **Coding agent skill template** — `installer/templates/skills/coding-agent.md`
- **Windsurf-to-Substrate migration docs** — `docs/WINDSURF_TO_SUBSTRATE_MIGRATION.md`

#### Changed
- **Auto-continue behavior** — Model now checks in with the user when task isn't complete instead of silently continuing to call tools; respects user interruptions for alignment on objective & priority
- **Chess app port** — Moved from 8000 to 5050 to avoid workbench conflict

#### Fixed
- **Dashboard build error** — Missing `Film` icon import in `AppearanceSettings.tsx` broke production builds
- **Workbench intermittent downtime** — Improved auto-start reliability

---

## [1.2.17] — 2026-05-25

### Widget & Chatbar Fixes

#### Fixed
- **Chatbar disappears on app reopen** — When the widget was closed (via ✕ button) while in collapsed state, the `collapsed: true` flag persisted to localStorage; on next page load or widget reopen, `nhBody` (containing the chatbar/chat pill) stayed hidden. Now `closeWidget()` resets collapsed state, and `reopenWidget()` explicitly forces `nhBody` visible.
- **Stale collapsed state on fresh auth** — Both the `substrate:authenticated` handler and the 2-second fallback init path now guard against stale `hub.collapsed` state by ensuring `nhBody` is visible when showing the widget.
- **Janky widget mode selector** — Mode buttons (Ask/Code/Plan) had tiny 3px padding hit targets and 0.28 opacity with no hover feedback; increased padding to 5×6px, added `border-radius`, hover/active background highlights, `pointer-events: none` on SVG children to prevent click swallowing, and faster 0.1s opacity transition for immediate visual feedback.
- **Mode switch UX** — Selecting a mode now auto-focuses the chat input and applies inline opacity for instant visual confirmation.

---

## [1.2.16] — 2026-05-23

### Workbench & Widget Fixes

#### Fixed
- **Workbench context menu dead on desktop** — Mouse clicks on context menu items (Download, Rotate, Delete, Generate Variation, Edit with AI, etc.) were blocked by `#moodBoardCanvas` overlay sitting on top in the DOM; fixed by moving context menu to `document.body` with `position: fixed` and `z-index: 99999`
- **Workbench image generation broken** — Deprecated `google-generativeai` SDK (v0.8.6) doesn't support `responseModalities`; switched to Gemini REST API directly with `responseModalities: ["TEXT", "IMAGE"]` and model fallback chain (`gemini-2.5-flash-image` → `gemini-2.5-flash`)
- **Widget settings button** — Now correctly opens the radial config settings panel instead of the old config toggle
- **Widget main trigger button** — Click now opens the web dashboard; radial menu expands on hover (matching main chat bar behavior)
- **Inline onclick handlers replaced** — All Workbench context menu actions now use `pointerup` event listeners via `data-action` attributes for cross-input (mouse + touch) compatibility

---

## [1.2.15] — 2026-05-23

### Vertex AI, UI Fix & Dashboard Enhancements

#### Added
- **Google Vertex AI support** — Full service account authentication for Vertex AI; accesses all Gemini models including 3.x series
- **Dual Google auth** — System supports both standard Gemini API keys (`generativelanguage.googleapis.com`) and Vertex AI service accounts simultaneously; Vertex takes priority when configured, standard keys work as before for all existing users
- **Dynamic model discovery** — `/api/discover-models` queries Vertex AI publisher models endpoint with pagination and smart filtering
- **Widget emotion GIF system** — Dashboard clock widget now loads and displays emotion GIFs synced from the server (`/ui/widget-style`), matching the Electron desktop widget
- **Cross-interface GIF persistence** — GIF choices set in any interface (Electron, WebUI, Dashboard) now sync to all others via server endpoint
- **Widget close button** — ✕ button in the widget top bar to fully dismiss it; persists across sessions
- **Chat icon hover flyout** — Hovering the chat icon reveals a flyout with "Chat" and "Widget" (re-open) options
- **Calendar drag-and-drop** — Kanban cards, content pills, and projects can be dragged onto the Media Suite calendar timeline
- **Day Planner drag-and-drop** — Drop items on day/week views to schedule them
- **Desktop widget** — Full emotion GIF panel with per-emotion slots, drag-drop URL management, cycling between variants
- **Kanban hooks** — `useCircuitsTasks` and `useMediaSuiteTasks` for task integration
- **Glass Chess** — Built-in chess game with adaptive AI opponent that learns from your play style; glass-themed UI, full move validation via python-chess, and persistent learning profile
- **Dual-monitor management skill**

#### Fixed
- **UI missing on fresh install/update** — Desktop widget had a debug line that force-enabled widget mode on every load, hiding the main chat bar and all interactive UI elements; now respects user preference (disabled by default)
- **Vertex AI endpoint** — Switched all 7 Vertex AI API calls from regional hostname (`us-central1-aiplatform.googleapis.com`) to global hostname (`aiplatform.googleapis.com`); regional endpoint only served older 2.5.x models, global serves all including 3.x
- **One-time migration** — Clears stale widget-enabled flag for users upgrading from previous versions so UI renders correctly on first launch
- `quickCreateProject` now includes `workspace_id` for secondary workspace persistence
- Hardcoded user paths removed from skill files (replaced with `%USERPROFILE%` / relative paths)
- Personal data files removed from git tracking (`chat_files.txt`, `profiles/default/*`)

#### Security
- `chloe_schedule.md`, `dashboard/src/chat_files.txt` added to `.gitignore`
- `profiles/default/config.json` and `profiles/default/avatar.png` untracked from git

---

## [1.2.0] — 2026-02-28

### First Public Release

The first source-available release of Substrate under the Business Source License 1.1.

### Included

- **17 built-in tools** — bash, text_editor, computer, browser, memory, web_search, web_fetch, generate_image, pdf, obsidian, skill, learn, media, look, notify, agent, macro
- **15 skills** — Obsidian notes, X posting, YouTube transcripts, PDF tools, RSS intelligence, virtual desktops, task scheduling, and more
- **Model-independent architecture** — works with any OpenAI-compatible API, local models via Ollama, or a hybrid of both
- **Persistent memory** — unified SQLite-backed memory with hybrid BM25 + vector search
- **Autonomous scheduling** — background channels for screenshots, messages, notes, and image generation
- **Full desktop control** — shell, browser (CDP), mouse, keyboard, screen capture via pyautogui/pywinauto
- **Voice I/O** — Kokoro TTS (local), ElevenLabs (cloud), Whisper speech recognition
- **Learning system** — automatic skill extraction from conversations, reusable markdown skill files
- **Command parser** — zero-LLM fast path for app launches, URLs, searches, and system commands
- **WebUI** — PWA-capable remote interface accessible from any device on your network
- **Robot embodiment** — bidirectional audio bridge to Raspberry Pi / XGO devices via local network or ZeroTier
- **Profile system** — multiple agent personalities with independent configs and avatars
- **Electron desktop app** — Windows 10/11 installer with automatic Python dependency management
- **MCP server support** — extensible via Model Context Protocol servers

### Architecture

- Electron frontend + Python backend with bidirectional IPC
- Flask API layer with WebSocket support
- 7 core tools always loaded, 10 on-demand tools loaded by context
- Token-efficient tool loading based on conversation trigger words
- API-level retry with exponential backoff

---

_For the full development history, see the [git log](https://github.com/propagationhouse/substrate/commits/main)._
