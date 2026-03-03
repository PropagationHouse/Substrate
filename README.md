<div align="center">

# Substrate

**An open-source autonomous desktop agent powered by local and cloud LLMs.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6.svg)](#system-requirements)
[![Version](https://img.shields.io/badge/Version-1.1.0-green.svg)](package.json)

</div>

---

Substrate is a fully autonomous desktop agent that gives an LLM complete control over your computer — shell commands, file operations, browser automation, mouse/keyboard, screen capture, voice I/O, memory, scheduling, and more. It runs locally with Ollama or connects to cloud providers (OpenAI, Anthropic, Google, Perplexity), and ships with both an Electron desktop app and a PWA-capable WebUI.

Think of it as an always-on AI co-pilot that lives on your machine, learns from your interactions, runs tasks on a schedule, and can operate autonomously in the background — all while keeping your data local.

<!-- TODO: Add screenshot here -->
<!-- ![Substrate Desktop UI](website/img/screenshot-desktop.png) -->

---

## Features

### Desktop Control
- **Shell execution** — Run any command with background support, streaming output, and process management
- **File operations** — Read, write, edit, grep, list, and inspect files with smart diffing
- **Process & window management** — List, kill, focus, resize, and send keystrokes to any window
- **Mouse & keyboard** — Pixel-level click, drag, scroll, hotkeys, and text typing
- **UI automation** — Windows-native element inspection and interaction via pywinauto
- **Screen capture & recording** — Screenshot any window or region, record screen sessions

### Multi-Model LLM Support
- **Local models** — Ollama (Llama, DeepSeek, Qwen, Dolphin, Mistral, Falcon, and more)
- **Cloud providers** — OpenAI (GPT-4), Anthropic (Claude), Google (Gemini), Perplexity
- **Any OpenAI-compatible endpoint** — LM Studio, vLLM, text-generation-webui, etc.
- **Hot-swap models** — Switch models mid-conversation from the UI dropdown
- **Vision support** — Send images to multimodal models for analysis

### Tool System
- **20+ built-in tools** — File ops, exec, browser, desktop, mouse, screen, memory, search, media, obsidian, and more
- **On-demand loading** — Tools activate based on conversation context (no wasted tokens)
- **MCP server support** — Connect external Model Context Protocol tool servers
- **Skill system** — Record workflows, save as reusable skills, promote from emergent to finalized
- **Plugin architecture** — Hook-based plugin system for extending functionality

### Browser Automation
- **CDP-based control** — Full Chrome DevTools Protocol automation of Chrome/Edge
- **Tab management** — Open, close, switch, and navigate tabs
- **Element interaction** — Click, type, submit forms, read content, extract elements
- **JavaScript evaluation** — Execute arbitrary JS in page context
- **Page screenshots** — Capture rendered pages for visual analysis

### Voice
- **Kokoro-82M** — Local text-to-speech with zero cloud dependency
- **ElevenLabs** — High-quality cloud TTS with voice cloning support
- **Speech recognition** — Voice input via microphone
- **Auto-speak** — Optionally speak all agent responses aloud

### Memory
- **Unified SQLite database** — Single source of truth for all memory
- **FTS5 full-text search** — Fast BM25 keyword matching
- **Vector embeddings** — Semantic similarity search with cached embeddings
- **Hybrid search** — Combined keyword + semantic retrieval with configurable weights
- **Session memory** — Cross-session context persistence
- **Deduplication** — Hash-based prevention of duplicate entries

### Circuits & Scheduling
- **CIRCUITS.md** — File-driven task scheduling (the agent reads and executes tasks from a markdown file)
- **Cron jobs** — Standard cron-style scheduling for recurring tasks
- **Background daemon** — System tray service that runs circuits even when the UI is closed
- **PRIME.md** — Startup tasks that run once on each cold boot

### Autonomous Mode
- **Background agent loops** — Periodic autonomous execution with configurable intervals
- **Sub-agent spawning** — Spawn parallel background agents for concurrent work
- **Followup queues** — Priority queue system for chaining autonomous actions
- **Screenshot observation** — Periodically observe and react to screen content

### Image Generation
- **DALL-E 3** — OpenAI image generation with prompt revision
- **Google Imagen** — Alternative image generation provider
- **Inline rendering** — Generated images appear directly in the chat with click-to-zoom

### Interfaces
- **Electron desktop app** — Animated avatar, retro-styled chat, radial config panel
- **WebUI** — PWA-capable browser UI accessible from any device on your network
- **Remote bridge** — HTTPS + QR code pairing for phone/tablet access
- **System tray** — Background daemon with quick-action menu

### And More
- **Profile system** — Multiple user profiles with separate configs, avatars, and knowledge
- **Canvas** — Shared scratchpad pages served via local HTTP
- **Webhooks** — Inbound webhook triggers for external integrations
- **Obsidian integration** — Vault operations, daily notes, search, backlinks, tags
- **RSS intelligence** — Automated news/feed monitoring and briefing generation
- **Intent classification** — Smart routing of user messages to appropriate handlers

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User Interfaces                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Electron App │  │   WebUI/PWA  │  │  System Tray │  │
│  │  (index.html │  │  (webui/)    │  │  (Gateway)   │  │
│  │   main.js)   │  │              │  │              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
└─────────┼─────────────────┼─────────────────┼───────────┘
          │ IPC/stdin       │ HTTP/WS         │ HTTP
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────┐
│              Python Backend (proxy_server.py)            │
│                                                         │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │  Chat   │ │  Tool    │ │  Memory  │ │  Gateway   │  │
│  │  Agent  │ │  Registry│ │  System  │ │  Circuits  │  │
│  └────┬────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘  │
│       │           │            │              │         │
│       ▼           ▼            ▼              ▼         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              LLM Provider Layer                 │    │
│  │  Ollama │ OpenAI │ Anthropic │ Google │ Custom  │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
Substrate/
├── main.js                  # Electron main process
├── preload.js               # IPC bridge (Electron ↔ Python)
├── index.html               # Desktop UI (avatar + chat + config)
├── proxy_server.py          # Python backend server (Flask)
├── gateway.py               # Background daemon entry point
├── config.json              # Runtime configuration
├── config.example.json      # Template configuration
├── requirements.txt         # Python dependencies
├── package.json             # Node.js dependencies
│
├── SUBSTRATE.md             # Agent personality / system identity
├── PRIME.md                 # Startup tasks (run once on boot)
├── CIRCUITS.md              # Scheduled tasks (checked periodically)
├── TOOL_PROMPT.md           # Tool system prompt template
│
├── src/
│   ├── tools/               # 20+ built-in tools
│   │   ├── tool_registry.py # Tool registration & on-demand loading
│   │   ├── exec_tool.py     # Shell command execution
│   │   ├── file_tool.py     # File operations
│   │   ├── browser_tool.py  # CDP browser automation
│   │   ├── desktop_tool.py  # Windows UI automation
│   │   ├── mouse_tool.py    # Mouse/keyboard control
│   │   ├── screen_tool.py   # Screenshots & recording
│   │   ├── memory_tool.py   # Memory search & storage
│   │   ├── web_tool.py      # Web search & fetch
│   │   ├── obsidian_tool.py # Obsidian vault operations
│   │   ├── skills_tool.py   # Skill management
│   │   ├── image_gen_tool.py# Image generation (DALL-E, Imagen)
│   │   └── ...              # + process, grep, pdf, gif, recorder
│   │
│   ├── gateway/             # Background service & scheduling
│   │   ├── tray_service.py  # System tray daemon
│   │   ├── circuits.py      # CIRCUITS.md task engine
│   │   ├── autonomous_runner.py  # Autonomous execution loop
│   │   ├── followup_queue.py     # Priority action queue
│   │   ├── substrate_prime.py    # Startup task runner
│   │   ├── webhooks.py      # Inbound webhook handling
│   │   ├── canvas.py        # Shared scratchpad pages
│   │   └── session_memory.py# Cross-session persistence
│   │
│   ├── memory/              # Memory & knowledge
│   │   ├── unified_memory.py# SQLite + FTS5 + vector search
│   │   └── memory_manager.py# Legacy memory interface
│   │
│   ├── voice/               # Voice I/O
│   │   ├── voice_handler.py # TTS orchestration
│   │   ├── elevenlabs_client.py  # ElevenLabs cloud TTS
│   │   └── tts_directives.py     # Voice style directives
│   │
│   ├── browser/             # Browser automation
│   │   ├── cdp_browser.py   # Chrome DevTools Protocol client
│   │   └── chrome_relay.py  # Remote browser relay
│   │
│   ├── search/              # Web search & RAG
│   ├── intent/              # Intent classification
│   ├── chat/                # Chat agent logic
│   ├── plugins/             # Plugin system (hooks, loader, registry)
│   ├── profiles/            # Profile management
│   └── model_manager.py     # Multi-provider model routing
│
├── static/                  # Frontend assets
│   ├── css/                 # Stylesheets (avatar, config panel)
│   └── js/                  # Avatar animation, editor, model panel
│
├── webui/                   # Progressive Web App UI
│   ├── index.html           # WebUI entry point
│   ├── main.js              # WebUI logic
│   ├── manifest.json        # PWA manifest
│   └── sw.js                # Service worker
│
├── skills/                  # Finalized reusable skills (.md)
├── knowledge/               # Knowledge base files
├── profiles/                # User profile storage
├── docs/                    # Developer documentation
└── website/                 # Project landing page
```

---

## System Requirements

- **OS**: Windows 10 or 11
- **Python**: 3.10+
- **Node.js**: 18+
- **Ollama**: Latest version (for local models)
- **RAM**: 8 GB minimum, 16 GB+ recommended (for local LLMs)
- **Disk**: ~2 GB for the app + model storage (varies by model)

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/user/substrate-agent.git
cd substrate-agent
```

### 2. Install dependencies

```bash
# Run the setup script (creates venv, installs Python + Node packages)
setup.bat
```

Or manually:

```bash
# Python
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Node
npm install
```

### 3. Configure

```bash
# Copy the example config
copy config.example.json config.json
```

Edit `config.json` to set your preferred model. The default is **Gemini 2.5 Flash** — add your Google API key to `custom_settings.json`:

```json
{
  "google_api_key": "AIza...",
  "openai_api_key": "sk-...",
  "anthropic_api_key": "sk-ant-...",
  "perplexity_api_key": "pplx-..."
}
```

For **local-only** operation (no API keys needed), install [Ollama](https://ollama.com/) and update `config.json`:

```bash
ollama pull llama3.2:latest
```

```json
{ "model": "llama3.2:latest", "api_endpoint": "http://localhost:11434/api/generate" }
```

### 4. Run

```bash
# Desktop app (Electron + Python backend)
start.bat

# Or run components separately:
python proxy_server.py          # Backend only (port 8765)
npx electron .                  # Frontend only
python gateway.py               # Background daemon only
```

### WebUI (Browser)

With the backend running, open `http://localhost:8765/ui` in any browser — works on phones and tablets too.

---

## Configuration Files

| File | Purpose |
|------|---------|
| `config.json` | Runtime settings — model, temperature, autonomy, profiles |
| `config.example.json` | Template with safe defaults (no API keys) |
| `custom_settings.json` | API keys and sensitive settings (gitignored) |
| `SUBSTRATE.md` | Agent personality and behavioral directives |
| `PRIME.md` | Tasks to run once on startup |
| `CIRCUITS.md` | Recurring scheduled tasks (checked every 30 min) |
| `TOOL_PROMPT.md` | System prompt template for tool-use mode |

---

## Tool Reference

| Tool | Description |
|------|-------------|
| `exec` | Run shell commands (foreground or background) |
| `process` | Manage processes, windows, background commands |
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `edit_file` | Find-and-replace edits in files |
| `list_dir` | List directory contents |
| `file_info` | Get file metadata |
| `grep` | Search file contents with regex |
| `web_search` | Search the web via Perplexity |
| `web_fetch` | Fetch and parse URL content as markdown |
| `browser_open` | Open a URL in the user's browser |
| `browser` | CDP browser automation (navigate, click, type, eval, screenshot) |
| `desktop` | Windows UI automation via pywinauto |
| `mouse` | Coordinate-based mouse/keyboard control |
| `screen` | Screenshots, window capture, screen recording |
| `look` | Camera capture and visual description |
| `cron` | Manage scheduled jobs |
| `memory_search` | Search conversation and knowledge memory |
| `memory_store_fact` | Store a fact in long-term memory |
| `find_skill` / `create_skill` | Find or create reusable skill workflows |
| `promote_skill` | Promote an emergent script to a finalized skill |
| `media` | GIF search, PDF text extraction |
| `obsidian` | Obsidian vault operations (notes, search, tags, backlinks) |
| `agent` | Spawn and manage background sub-agents |
| `generate_image` | Generate images via DALL-E 3 or Google Imagen |
| `notify` | Send Windows toast notifications |

Tools from external **MCP servers** are also supported and appear with a server-name prefix (e.g., `github_create_issue`).

---

## Skills System

Skills are reusable workflows stored as markdown files in `skills/`.

1. **Emergent** — The agent writes a script to `workspace/emergent/` during a task
2. **Promoted** — After user confirmation, the skill is moved to `skills/` as a finalized `.md` file
3. **Discovered** — The agent can search and execute existing skills via `find_skill`

Example skills: Reddit posting, RSS intelligence checks, YouTube transcript scraping, Obsidian workflows, virtual desktop management, and more.

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Config Panel Guide](docs/CONFIG_PANEL_GUIDE.md) | Using the settings UI |
| [Command System](docs/COMMAND_SYSTEM.md) | Available commands and usage |
| [Memory System](docs/MEMORY_SYSTEM.md) | How memory storage and retrieval works |
| [Voice System](docs/VOICE_SYSTEM.md) | TTS configuration and voice options |
| [Remote Bridge](docs/REMOTE_BRIDGE.md) | Accessing Substrate from other devices |
| [WebUI Guide](docs/WEBUI.md) | Browser-based UI guide |
| [Profile System](docs/PROFILE_SYSTEM.md) | Multi-user profile management |
| [Agent Self-Awareness](docs/AGENT_SELF_AWARENESS.md) | Agent personality and behavior |
| [Plugin System](src/plugins/) | Extending Substrate with plugins |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| App won't start | Ensure Python, Node.js, and Ollama are installed and in PATH |
| No LLM responses | Check Ollama is running (`ollama serve`) and model is pulled |
| Voice not working | Install Kokoro: `pip install misaki` or configure ElevenLabs key |
| Browser automation fails | Ensure Chrome/Edge is installed; CDP uses port 9222 |
| Slow responses | Try a smaller local model (`llama3.2:3b`) or use a cloud model |
| WebUI can't connect | Verify backend is running on port 8765 |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting issues, pull requests, and code style.

---

## License

This project is licensed under the [Business Source License 1.1](LICENSE). Free for non-commercial use (personal, educational, research). Commercial use requires a separate license — contact phsds@proton.me. On February 1, 2029, the license automatically converts to Apache License 2.0.

---

## Acknowledgments

- [Ollama](https://ollama.com/) — Local LLM inference
- [Electron](https://www.electronjs.org/) — Desktop application framework
- [Kokoro](https://github.com/hexgrad/kokoro) — Local text-to-speech
- [ElevenLabs](https://elevenlabs.io/) — Cloud voice synthesis
- [Perplexity](https://www.perplexity.ai/) — Web search API
- [Flask](https://flask.palletsprojects.com/) — Python web framework
- [pywinauto](https://github.com/pywinauto/pywinauto) — Windows UI automation
