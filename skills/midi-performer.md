# MIDI Performer Skill

This skill allows the agent to perform infinite, generative MIDI music on the Yamaha MX Series-1 1 synthesizer (or other connected MIDI devices) in various styles.

## Triggers
- "play some music"
- "infinite vibe"
- "jazz style"
- "chill style"
- "keep playing until I say stop"

## Execution Logic

1.  **Script**: Uses `workspace/midi_performer.py`.
2.  **Parameters**:
    - `style`: 'jazzy' (default), 'chill', etc.
3.  **Action**: Runs the script in the background using `bash` with `python`.
4.  **Termination**: The process must be manually killed using `exec_kill` or by finding the PID.

## Usage Example

```bash
# Run in background
python workspace/midi_performer.py jazzy
```

To stop:
```bash
# Find the PID
ps | grep python
# Kill it
kill <PID>
```

## Chord Sets
The script currently supports:
- `jazzy`: Extended 9ths, 11ths, 13ths, and altered dominants.
- `chill`: Smooth major 9ths and minor 9ths.

## Customization
To add new styles or chords, edit the `CHORDS` dictionary in `workspace/midi_performer.py`.
