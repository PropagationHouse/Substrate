import music21
import os

def create_sheet_music():
    base_path = r'C:\Users\Bl0ck\(ph)'
    chords_path = os.path.join(base_path, 'somber_jazz_loop.mid')
    bass_path = os.path.join(base_path, 'somber_jazz_bass.mid')
    output_xml = os.path.join(base_path, 'somber_jazz_sheet.musicxml')

    # Load MIDI files
    chords_score = music21.converter.parse(chords_path)
    bass_score = music21.converter.parse(bass_path)

    # Create a new Score
    final_score = music21.stream.Score()
    
    # Add metadata
    final_score.insert(0, music21.metadata.Metadata())
    final_score.metadata.title = 'Somber Jazz Session'
    final_score.metadata.composer = 'AI & Homie'

    # The chords MIDI might have multiple parts (Piano)
    for part in chords_score.parts:
        part.partName = 'Piano'
        final_score.insert(0, part)

    # The bass MIDI
    for part in bass_score.parts:
        part.partName = 'Bass'
        # Ensure it's in Bass Clef if it's not
        for measure in part.getElementsByClass(music21.stream.Measure):
            if not measure.getElementsByClass(music21.clef.Clef):
                measure.insert(0, music21.clef.BassClef())
        final_score.insert(0, part)

    # Write to MusicXML
    final_score.write('musicxml', fp=output_xml)
    print(f'MusicXML written to {output_xml}')

if __name__ == '__main__':
    create_sheet_music()
