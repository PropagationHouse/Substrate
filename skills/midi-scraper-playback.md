# MIDI Scraper & Playback Skill

This skill allows the agent to find, download, and play MIDI files from the web on a connected MIDI device (typically the Yamaha MX). It also logs the performance to Obsidian for archival.

## Triggers
- "find and play [song name] midi"
- "scrape [composer] midi and play it"
- "play [song] on the yamaha"

## Execution Logic

1.  **Search**: Use `web_search` to find a direct MIDI download link (e.g., from `piano-midi.de`).
2.  **Download**: Use `curl` to download the MIDI file to the user's MIDI directory.
    ```bash
    mkdir -p "%USERPROFILE%\ph\👻\🎼\🎶"
    curl -L -o "%USERPROFILE%\ph\👻\🎼\🎶\[filename].mid" "[url]"
    ```
3.  **Find Port**: Identify the correct MIDI output port.
    ```bash
    python workspace/find_yamaha.py
    ```
4.  **Play**: Run the playback script in the background.
    ```bash
    python workspace/play_midi.py "%USERPROFILE%\ph\👻\🎼\🎶\[filename].mid" "[port_name]"
    ```
5.  **Log to Obsidian**: Create a new note in `%USERPROFILE%\ph\MIDI\` with the following format:
    - Title: `[Song Name] - [Composer]`
    - Content:
        - Composer: `[Composer]`
        - URL: `[Source URL]`
        - Date: `[Current Date]`
        - Status: Played on Yamaha MX

## Notes
- If multiple ports are found, prefer the one with "Series-1" or "Port 1".
- Ensure `mido` and `python-rtmidi` are installed in the environment.
