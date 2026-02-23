from midiutil import MIDIFile
import os

# Define the path
vault_path = r"C:\Users\Bl0ck\Documents\Obsidian\Notes"
filename = "somber_jazz_loop.mid"
filepath = os.path.join(vault_path, filename)

# Create MIDI object
midi = MIDIFile(1)
track = 0
time = 0
midi.addTrackName(track, time, "Somber Jazz Loop")
midi.addTempo(track, time, 70)

# Chords (Notes in MIDI numbers)
# Dm9: D2(38), F3(53), A3(57), C4(60), E4(64)
# G13: G2(43), F3(53), B3(59), E4(64)
# Cmaj9: C2(36), E3(52), G3(55), B3(59), D4(62)
# Am7: A2(45), G3(55), C4(60), E4(64)

progression = [
    [38, 53, 57, 60, 64], # Dm9
    [43, 53, 59, 64],     # G13
    [36, 52, 55, 59, 62], # Cmaj9
    [45, 55, 60, 64]      # Am7
]

channel = 0
volume = 80

for i, chord in enumerate(progression):
    for note in chord:
        midi.addNote(track, channel, note, time + (i * 4), 4, volume)

# Write to file
with open(filepath, "wb") as output_file:
    midi.writeFile(output_file)

print(f"Created {filepath}")
