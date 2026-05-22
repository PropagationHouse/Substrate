---
name: MIDI Diagnostic
description: A robust procedure for listing and testing MIDI output ports to ensure hardware connectivity.
triggers: midi diagnostic,check midi ports,test midi,find yamaha,midi troubleshooting
---

# MIDI Diagnostic Skill

This skill provides a robust way to identify and test MIDI output ports, specifically for the Yamaha MX88 and other hardware.

## Triggers
- midi diagnostic
- check midi ports
- test midi
- find yamaha
- midi troubleshooting

## Procedure

### 1. List Available Ports
Run the diagnostic script to see all currently visible MIDI output names.
```bash
python workspace/midi_diagnostic.py
```

### 2. Identify the Target Port
Look for "Yamaha MX Series-2" (usually Port 2). Note the index number in the list.

### 3. Test a Specific Channel
To verify connectivity, send a test note to a specific channel (1-16).
```bash
# Usage: python workspace/midi_diagnostic.py [index] [channel_1_indexed]
python workspace/midi_diagnostic.py 3 1
```
*Note: The index might change depending on what hardware is plugged in. Always run step 1 first.*

### 4. Continuous Channel Test
If you need to sweep through channels to find where the synth is listening:
```python
import mido, time
port_name = "Yamaha MX Series-2 3" # Update based on step 1
with mido.open_output(port_name) as out:
    for chan in range(16):
        print(f"Testing Channel {chan+1}")
        out.send(mido.Message('note_on', note=60, velocity=100, channel=chan))
        time.sleep(1)
        out.send(mido.Message('note_off', note=60, velocity=100, channel=chan))
```

## Troubleshooting
- **Port Locked**: If a port is in use by another application (like Maschine or a DAW), `mido` might fail to open it.
- **Index Shift**: Unplugging/replugging MIDI devices can shift the index. Always re-run the listing.
- **No Sound**: Ensure the Yamaha MX is in "Multi" mode or "Part" mode where it expects external MIDI on the target channel.
