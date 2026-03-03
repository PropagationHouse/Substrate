# Changelog

All notable changes to Substrate will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
