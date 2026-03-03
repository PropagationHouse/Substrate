# WebUI Guide

This guide covers running the browser WebUI, connecting it to the backend, using image+text chat, and enabling the avatar motion effects.

## Overview
- Directory: `webui/`
- Entry point: `webui/index.html`
- Backend API: `proxy_server.py` (default port `8765`)
- Default proxy base used by the WebUI: `http(s)://<host>:8765` (can be overridden with a query param)

## Prerequisites
- Backend running: start the Python server
```
python proxy_server.py
```
- Ollama running locally with the configured models (see main README for models)

## Starting the WebUI
- Option 1 (local file): Open `webui/index.html` directly in your browser.
- Option 2 (static hosting): Serve the `webui/` directory from any static file server.

If your backend is not at `http(s)://<this-host>:8765`, pass a proxy override:
```
webui/index.html?proxy=http://<backend-host>:<port>
```
Example:
```
webui/index.html?proxy=http://localhost:8765
```

## Chat usage
- Type in the input and press Enter to send.
- Shift+Enter inserts a newline.
- Click the + button to pick an image; it will be held as pending and sent with your next message.
- The WebUI polls for responses from the backend and streams assistant text into the current message bubble.

## Image + text flow
- Selecting an image shows a preview in your outgoing bubble with a "pending" note.
- When you press Enter with text, the image is sent together with the message.
- Backend route used: `POST /api/input` with optional image payload.
- Vision model path: local (e.g., `llama-3.2-vision:11b`) via the backend processor.

## Backend endpoints used by the WebUI
- `POST /api/input` — primary input endpoint for both text and optional image.
- `GET  /api/messages?since=<index>` — message/event polling for new outputs.
- (Optional) `GET /audio/...` — voice playback if enabled.

## Avatar motion and controls
- The WebUI includes autonomous idle motion:
  - Continuous micro motion so the avatar is never fully still.
  - Periodic larger "glances" with brief holds and eye saccades.
- Motion debug:
  - Press `g` to trigger a glance.
  - In DevTools console, call `__forceGlance('left')` or `__forceGlance('right')`.
- Optional tilt debug HUD: add `?debugTilt=1` to the URL to display live sensor values if your device/browser provides them.
- Notes on sensors:
  - Real device tilt may be blocked on non-HTTPS contexts by some mobile browsers.
  - The WebUI does not require sensors; the avatar still animates via its idle motion.

## Troubleshooting
- No responses:
  - Ensure `proxy_server.py` is running on the host/port the WebUI is pointing to.
  - Check browser console for network errors; verify the `proxy` query param if used.
- Image send not attaching:
  - Confirm you see the pending image label in your outgoing bubble before pressing Enter.
- Motion not visible:
  - Hard refresh to ensure the latest `webui/main.js` is loaded.
  - Press `g` to force a glance; check the console for `Glance { ... }` logs.
  - If using a phone for tilt, try HTTPS and allow Motion Sensors in the site settings.

## Notes
- The WebUI is independent of Electron; you can use it from any modern browser.
- By default the WebUI assumes the backend is on the same host at port `8765`. Use `?proxy=` to point to a different host/port.
