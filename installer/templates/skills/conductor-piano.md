# Structural Conductor Piano
Evolves the piano performance from random layers to structural awareness using a "Conductor" logic.

## Triggers
- play structural piano
- conductor piano
- miyazaki conductor
- start jazz conductor

## Architecture
- **Conductor**: Manages global bar count and tempo.
- **Baseline**: Root-centric with leading-tone transitions.
- **Chord Voicings**: Extended jazz chords (9ths, 13ths) with syncopated hits.
- **Melody**: Question/Answer phrasing, rubato timing, and velocity mapping.

## Usage
Run the script via bash:
```bash
python workspace/emergent/conductor_piano.py
```

## Refinement
The script uses `threading` to decouple layers while maintaining sync via the `Conductor` tick. Velocity is dynamically mapped to melodic height to simulate human touch.
