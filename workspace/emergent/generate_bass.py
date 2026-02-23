import mido
from mido import Message, MidiFile, MidiTrack

def create_bassline():
    mid = MidiFile()
    track = MidiTrack()
    mid.tracks.append(track)

    # Tempo: 70 BPM (857143 microseconds per beat)
    track.append(mido.MetaMessage('set_tempo', tempo=857143))
    track.append(mido.MetaMessage('track_name', name='Somber Jazz Bass'))

    # 480 ticks per beat
    # Progression: Dm9, G13, Cmaj9, Am7 (1 bar each)
    
    # Bass notes (MIDI numbers): D1=38, G1=31, C2=36, A1=33
    # We'll add some flavor notes
    
    # Bar 1: Dm9
    notes = [
        (38, 480), # D2
        (41, 240), # F2
        (43, 240), # G2
        (45, 480), # A2
        (43, 480), # G2
    ]
    
    # Bar 2: G13
    notes += [
        (31, 480), # G1
        (35, 480), # B1
        (38, 480), # D2
        (41, 480), # F2
    ]
    
    # Bar 3: Cmaj9
    notes += [
        (36, 480), # C2
        (40, 480), # E2
        (43, 480), # G2
        (47, 480), # B2
    ]
    
    # Bar 4: Am7
    notes += [
        (33, 480), # A1
        (36, 240), # C2
        (38, 240), # D2
        (40, 480), # E2
        (35, 480), # B1 (leading back to D)
    ]

    for note, duration in notes:
        track.append(Message('note_on', note=note, velocity=85, time=0))
        track.append(Message('note_off', note=note, velocity=85, time=duration))

    mid.save('somber_jazz_bass.mid')

if __name__ == "__main__":
    create_bassline()
