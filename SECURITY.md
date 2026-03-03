# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.2.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Substrate, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email **phsds@proton.me** with:

- A description of the vulnerability
- Steps to reproduce it
- The potential impact
- Any suggested fixes (optional)

You will receive an acknowledgment within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

This policy covers the Substrate codebase and its first-party components. Third-party dependencies (e.g., Electron, Flask, Kokoro, Ollama) should be reported to their respective maintainers.

## Security Considerations

Substrate is a desktop agent with full OS-level access by design. Users should be aware that:

- The agent can execute shell commands, control the browser, and interact with the desktop
- API keys stored in `custom_settings.json` should be protected like passwords
- The WebUI remote bridge should only be exposed on trusted networks or via ZeroTier
- No telemetry or data is sent to external servers unless explicitly configured by the user
