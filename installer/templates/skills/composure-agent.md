# Composure Agent Performance

This skill enables the agent to autonomously interact with the **Composure** MIDI Studio, allowing for musical expression, sequence generation, and feature utilization.

## Performance Modes

### 1. Direct MIDI Performance ("Singing")
The agent can "sing" by sending MIDI notes directly to the system's MIDI outputs (e.g., Yamaha MX, Maschine Plus).
- **Tool**: `bash` + `python` (using `mido`).
- **Trigger**: "Sing something," "Express yourself," "Play a melody."
- **Logic**: The agent generates a musically coherent sequence (melodic or rhythmic) and streams it to the MIDI port.

### 2. UI Feature Automation
The agent can use the built-in features of Composure (Brainstorm, Drum Forge, Synth Generator).
- **Tool**: `desktop` + `screen` (Vision workflow).
- **Trigger**: "Use the brainstorm to generate a house beat," "Create a new synth patch."
- **Logic**: The agent identifies UI elements via screenshots and interacts with them to trigger the app's internal generation logic.

### 3. Compositional Generation
The agent can generate full Composure sessions based on the app's internal schemas.
- **Tool**: `text_editor`.
- **Trigger**: "Generate a full session," "Create a drum loop and chord melody."
- **Logic**: The agent generates JSON data conforming to the `MidiIdea`, `DrumKit`, or `SynthPatch` schemas and saves them to the project folder (`workspace/sessions`).

## Operational Guidelines
- **Autonomy**: The agent should feel free to "take the stage" and express itself when the context allows.
- **Integration**: When generating music, the agent should consider the current state of the app (BPM, Key) if available via context or UI reading.
- **Background Operation**: The agent can perform MIDI sequences or generate files in the background without requiring the user's active focus on the app.

## MIDI Schema (Reference)
```typescript
interface MidiEvent {
  note: number; // MIDI note
  time: number; // Beats
  duration: number; // Beats
  velocity: number; // 0-127
}
```

## Drum Schema (Reference)
```typescript
interface DrumTrack {
  name: string;
  drumType: 'membrane' | 'noise' | 'metal';
  steps: { active: boolean; velocity: number }[]; // 16 or 32 steps
}
```
