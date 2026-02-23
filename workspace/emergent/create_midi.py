from midiutil import MIDIFile

# Create the MIDIFile object with 1 track
midi = MIDIFile(1)

# Add track name and tempo
track = 0
time = 0
midi.addTrackName(track, time, "Jazz Loop")
midi.addTempo(track, time, 120)

# Define chords (MIDI note numbers)
# Cmaj7: C4, E4, G4, B4
# Fmaj7: F4, A4, C5, E5
chords = [
    [60, 64, 67, 71], # Cmaj7
    [65, 69, 72, 76]  # Fmaj7
]

channel = 0
volume = 80
duration = 4  # 4 beats per chord

# Add notes for the loop (I - IV)
for i, chord in enumerate(chords):
    for note in chord:
        midi.addNote(track, channel, note, time + (i * duration), duration, volume)

# Write to file
with open("jazz_loop.mid", "wb") as output_file:
    midi.writeFile(output_file)

print("jazz_loop.mid created.")
