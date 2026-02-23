# TPXGO File Audit Report
Generated: 2026-02-03

## Summary
This audit identifies files in the main project directory that are **not referenced** by the core application files (main.js, proxy_server.py, preload.js, index.html).

---

## CORE FILES (KEEP - Essential)
These are the main entry points and actively used files:

### Python - USED
| File | Referenced By |
|------|---------------|
| `proxy_server.py` | main.js (spawned as main Python process) |
| `main.py` | main.js, proxy_server.py |
| `context_assistant_updater.py` | proxy_server.py |
| `main_app_integration.py` | proxy_server.py |
| `aurora_forecast.py` | proxy_server.py |
| `command_pipe.py` | proxy_server.py |
| `image_processor.py` | proxy_server.py |
| `voice_handler.py` | proxy_server.py (but src/voice/voice_handler.py is the real one) |
| `xgo_vision_client_reference.py` | main.js |

### JavaScript - USED
| File | Referenced By |
|------|---------------|
| `main.js` | Electron entry point |
| `preload.js` | main.js |
| `auto_save_config.js` | index.html |
| `debug_renderer.js` | index.html |
| `direct_chat_renderer.js` | index.html |
| `direct_config_loader.js` | index.html |
| `element_inspector.js` | index.html |
| `radial_config_new.js` | index.html |
| `raw_text_renderer.js` | index.html |
| `simple_text_renderer.js` | index.html |

### HTML - USED
| File | Referenced By |
|------|---------------|
| `index.html` | main.js (main window) |

---

## UNUSED FILES - CANDIDATES FOR REMOVAL

### Python Files (Test/Debug/Old)
These appear to be test files, old implementations, or standalone utilities:

| File | Size | Likely Purpose | Recommendation |
|------|------|----------------|----------------|
| `add_to_main_app.py` | 7KB | Old integration script | REMOVE |
| `audio_energy_monitor.py` | 3KB | Standalone utility | REMOVE |
| `chat_capture.py` | 2KB | Debug/test | REMOVE |
| `check_api.py` | 1KB | Test script | REMOVE |
| `cleanup_bloat.py` | 4KB | Utility script | REMOVE |
| `clipboard_monitor.py` | 3KB | Standalone utility | REMOVE |
| `command_server.py` | 26KB | Old server implementation | REMOVE |
| `context_assistant_updater - Copy.py` | 7KB | Backup file | REMOVE |
| `debug_flow.py` | 12KB | Debug script | REMOVE |
| `direct_command_bridge.py` | 6KB | Old bridge | REMOVE |
| `direct_midjourney_command.py` | 3KB | Old command | REMOVE |
| `embed_codebase.py` | 2KB | Utility | REMOVE |
| `generate_app_paths.py` | 5KB | Utility | REMOVE |
| `home_pc_server.py` | 6KB | Old server | REMOVE |
| `image_test.py` | 43KB | Test file | REMOVE |
| `initialize_code_memory.py` | 7KB | Setup script | KEEP (may need for setup) |
| `integrate_with_main_app.py` | 8KB | Old integration | REMOVE |
| `ipc_client.py` | 4KB | Old IPC | REMOVE |
| `ipc_server.py` | 7KB | Old IPC | REMOVE |
| `news_api_handler.py` | 6KB | Unused handler | REMOVE |
| `news_search_handler.py` | 2KB | Unused handler | REMOVE |
| `open_windy.py` | 4KB | Utility | REMOVE |
| `pc_audio_receiver_server.py` | 3KB | Old server | REMOVE |
| `project_analyzer.py` | 15KB | Utility | REMOVE |
| `remote_agent_server.py` | 18KB | Old remote | REMOVE |
| `remote_bridge.py` | 38KB | Old bridge | REMOVE |
| `remote_chat_server.py` | 16KB | Old server | REMOVE |
| `remote_test_server.py` | 8KB | Test server | REMOVE |
| `response_notifier.py` | 5KB | Old notifier | REMOVE |
| `response_server.py` | 5KB | Old server | REMOVE |
| `runtime_analyzer.py` | 15KB | Utility | REMOVE |
| `scheduled_midjourney.py` | 21KB | NOT referenced by main app | REMOVE |
| `send_context.py` | 0.5KB | Utility | REMOVE |
| `setup_independent.py` | 4KB | Setup script | REMOVE |
| `simple_embed.py` | 6KB | Utility | REMOVE |
| `simple_test_server.py` | 26KB | Test server | REMOVE |
| `test_*.py` (all) | Various | Test files | REMOVE |
| `tiny_pirate_simple_endpoint.py` | 1KB | Old endpoint | REMOVE |
| `toggle_auto_snapshot.py` | 2KB | Utility | REMOVE |
| `trigger_midjourney.py` | 5KB | Utility | REMOVE |
| `verify_*.py` (all) | Various | Verification scripts | REMOVE |
| `xgo_action_codes.py` | 2KB | XGO utility - standalone | REMOVE |
| `xgo_audio_receiver.py` | 3KB | Duplicate of XGO_Audio_Bridge version | REMOVE |
| `xgo_audio_server.py` | 4KB | XGO utility - standalone | REMOVE |
| `xgo_diagnostic.py` | 2KB | XGO utility - standalone | REMOVE |
| `xgo_expand_storage.py` | 8KB | XGO utility - standalone | REMOVE |
| `xgo_low_power_toggle.py` | 5KB | XGO utility - standalone | REMOVE |
| `xgo_perfect_avatar.py` | 10KB | XGO utility - standalone | REMOVE |
| `xgo_register_probe.py` | 3KB | XGO utility - standalone | REMOVE |
| `xgo_remote_mic.py` | 14KB | XGO utility - standalone | REMOVE |
| `youtube_api_transcript.py` | 9KB | NOT USED - src/youtube/ has the real handlers | REMOVE |
| `yt_dlp_transcript.py` | 7KB | NOT USED - src/youtube/ has the real handlers | REMOVE |

### JavaScript Files (Unused)
| File | Size | Recommendation |
|------|------|----------------|
| `chat_replacement.js` | 18KB | REMOVE |
| `clean_solution.js` | 6KB | REMOVE |
| `config_viewer.js` | 16KB | REMOVE |
| `direct_animation_test.js` | 9KB | REMOVE |
| `direct_config_injector.js` | 8KB | REMOVE |
| `direct_element_update.js` | 9KB | REMOVE |
| `direct_html_renderer.js` | 14KB | REMOVE |
| `direct_html_renderer.js.new` | 17KB | REMOVE |
| `direct_html_test.js` | 12KB | REMOVE |
| `direct_input_update.js` | 8KB | REMOVE |
| `direct_override.js` | 14KB | REMOVE |
| `disable_html_rendering.js` | 5KB | REMOVE |
| `element_finder.js` | 5KB | REMOVE |
| `fix_radial_inputs.js` | 9KB | REMOVE |
| `force_config_update.js` | 14KB | REMOVE |
| `html_renderer.js` | 25KB | REMOVE |
| `html_window_renderer.js` | 17KB | REMOVE |
| `launcher.js` | 3KB | REMOVE |
| `load_custom_settings.js` | 2KB | REMOVE |
| `prevent-click-through.js` | 1KB | REMOVE |
| `raw_html_display.js` | 3KB | REMOVE |
| `simple_fix.js` | 1KB | REMOVE |
| `test_html_integration.js` | 14KB | REMOVE |
| `test_html_render.js` | 3KB | REMOVE |

### Other Files to Review
| File | Type | Recommendation |
|------|------|----------------|
| `*.log` files | Logs | REMOVE (can regenerate) |
| `*.bak*` files | Backups | REMOVE |
| `proxy_server.py.bak_*` | Backup | REMOVE |
| `eleven_agents_*.html` | Documentation | REVIEW |
| `*_README.md` files | Documentation | KEEP (useful) |
| `*.md` plan files | Documentation | REVIEW |

---

## SAFE TO REMOVE (High Confidence)

### Batch 1 - Test Files
```
test_autonomous_midjourney.py
test_chat_context.py
test_ipc_server.py
test_kokoro_settings.py
test_midjourney.py
test_midjourney_automation.py
test_midjourney_fixes.py
test_response_server.py
test_system.py
test_voice_settings_fix.py
verify_chill_fix.py
verify_complete_removal.py
```

### Batch 2 - Old/Duplicate Files
```
context_assistant_updater - Copy.py
proxy_server.py.bak_20251010_171907
direct_html_renderer.js.new
```

### Batch 3 - Unused JS Renderers
```
chat_replacement.js
clean_solution.js
config_viewer.js
direct_animation_test.js
direct_config_injector.js
direct_element_update.js
direct_html_renderer.js
direct_html_test.js
direct_input_update.js
direct_override.js
disable_html_rendering.js
element_finder.js
fix_radial_inputs.js
force_config_update.js
html_renderer.js
html_window_renderer.js
launcher.js
load_custom_settings.js
prevent-click-through.js
raw_html_display.js
simple_fix.js
test_html_integration.js
test_html_render.js
```

### Batch 4 - Old Server Implementations
```
command_server.py
home_pc_server.py
ipc_client.py
ipc_server.py
pc_audio_receiver_server.py
remote_agent_server.py
remote_bridge.py
remote_chat_server.py
remote_test_server.py
response_notifier.py
response_server.py
simple_test_server.py
```

---

## FOLDERS TO REVIEW
| Folder | Items | Recommendation |
|--------|-------|----------------|
| `__pycache__/` | 22 | Can delete (regenerates) |
| `logs/` | 80 | Can clean old logs |
| `venv_208/` | 860 | Old venv? REMOVE if not used |
| `python_scripts/` | 5343 | REVIEW - may be duplicate of src/ |

---

## NEXT STEPS
1. Review this report
2. Confirm which files to remove
3. Run cleanup command (provided below)

