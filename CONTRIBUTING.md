# Contributing to Substrate

Thanks for your interest in contributing! Here's how to get started.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Create a branch** for your feature or fix: `git checkout -b my-feature`
4. **Make your changes** and test them
5. **Commit** with a clear message: `git commit -m "Add feature X"`
6. **Push** to your fork: `git push origin my-feature`
7. **Open a Pull Request** against `main`

## Development Setup

```bash
# Clone and install
git clone https://github.com/propagationhouse/substrate.git
cd substrate
setup.bat

# Or manually:
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
npm install
```

## Code Style

- **Python**: Follow PEP 8. Use type hints where practical. Keep functions focused.
- **JavaScript**: Use `const`/`let` (no `var`). Prefer vanilla JS — the project avoids frontend frameworks.
- **Comments**: Don't over-comment obvious code. Do comment non-obvious logic and architectural decisions.
- **Naming**: `snake_case` for Python, `camelCase` for JavaScript.

## Project Layout

- `proxy_server.py` — Main backend server. Large file — search before editing.
- `src/tools/` — Each tool is a self-contained module. Follow existing patterns when adding new tools.
- `src/gateway/` — Background services and scheduling. Be careful with threading.
- `static/js/` — Frontend avatar and UI logic.
- `webui/` — Standalone browser UI (PWA).

## Adding a New Tool

1. Create `src/tools/your_tool.py` following the pattern in existing tools
2. Register it in `src/tools/tool_registry.py`:
   - Add to `ON_DEMAND_TOOLS` with keyword triggers for on-demand loading
   - Or add to core registration for always-available tools
3. Add a one-line entry to the tool table in `TOOL_PROMPT.md`
4. Update the Tool Reference table in `README.md`

## Reporting Issues

- **Bug reports**: Include steps to reproduce, expected vs actual behavior, and your OS/Python/Node versions.
- **Feature requests**: Describe the use case, not just the solution.
- **Security issues**: Do NOT open a public issue. Email the maintainer directly.

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Don't bundle unrelated changes
- Test your changes locally before submitting
- Update documentation if your change affects user-facing behavior
- Don't commit API keys, credentials, or personal data

## What We're Looking For

- **New tools** — Expand the agent's capabilities
- **Cross-platform support** — Linux/macOS compatibility improvements
- **Performance** — Faster startup, lower memory usage, smarter token management
- **Tests** — Unit and integration tests (currently minimal)
- **Documentation** — Improve guides, add examples, fix typos
- **UI/UX** — Better desktop and WebUI experiences

## License

By contributing, you agree that your contributions will be licensed under the [Business Source License 1.1](LICENSE).
