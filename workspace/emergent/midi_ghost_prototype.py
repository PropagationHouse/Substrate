import mido
import sounddevice as sd
import soundfile as sf
import json
import time
import os
import threading
import queue
import sys

# Configuration
WORKSPACE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
VAULT_DIR = os.path.join(WORKSPACE_DIR, "MIDI_Vault")
os.makedirs(VAULT_DIR, exist_ok=True)
SESSION_ID = int(time.time())

# File paths
AUDIO_FILE = os.path.join(VAULT_DIR, f"ghost_{SESSION_ID}.wav")
MIDI_JSON_FILE = os.path.join(VAULT_DIR, f"ghost_{SESSION_ID}_raw.json")

# Shared state
midi_events = []
audio_queue = queue.Queue()
recording = True

def audio_callback(indata, frames, time_info, status):
    if status:
        print(status, file=sys.stderr)
    if recording:
        audio_queue.put(indata.copy())

def audio_writer():
    try:
        # Get default input device info to set samplerate and channels
        device_info = sd.query_devices(sd.default.device[0], 'input')
        samplerate = int(device_info['default_samplerate'])
        channels = device_info['max_input_channels']
        
        with sf.SoundFile(AUDIO_FILE, mode='w', samplerate=samplerate, channels=channels) as file:
            while recording or not audio_queue.empty():
                try:
                    data = audio_queue.get(timeout=0.1)
                    file.write(data)
                except queue.Empty:
                    continue
    except Exception as e:
        print(f"[!] Audio error: {e}")

def find_midi_port():
    try:
        ports = mido.get_input_names()
        for port in ports:
            if "MX" in port or "Yamaha" in port:
                return port
        return ports[0] if ports else None
    except Exception as e:
        print(f"[!] Error finding MIDI ports: {e}")
        return None

def main():
    global recording
    
    print("\n--- Ghost Prototype: Starting ---")
    
    # 1. Start Audio
    audio_thread = threading.Thread(target=audio_writer)
    audio_thread.start()
    
    try:
        audio_stream = sd.InputStream(callback=audio_callback)
        audio_stream.start()
        print(f"[*] Audio recording started -> {AUDIO_FILE}")
    except Exception as e:
        print(f"[!] Failed to start audio stream: {e}")
        audio_stream = None

    # 2. Start MIDI
    port_name = find_midi_port()
    midi_port = None
    if not port_name:
        print("[!] No MIDI ports found. Make sure your MX88 is plugged in.")
    else:
        print(f"[*] Found MIDI port: {port_name}")
        try:
            midi_port = mido.open_input(port_name)
            print(f"[*] MIDI recording started -> {MIDI_JSON_FILE}")
        except Exception as e:
            print(f"[!] Failed to open MIDI port: {e}")

    print("\n[*] RECORDING ACTIVE. Play your MX88. Press Ctrl+C to stop.\n")
    
    try:
        if midi_port:
            for msg in midi_port:
                event = {
                    "time": time.time(),
                    "type": msg.type,
                    "bytes": msg.bytes()
                }
                if hasattr(msg, 'note'):
                    event["note"] = msg.note
                if hasattr(msg, 'velocity'):
                    event["velocity"] = msg.velocity
                if hasattr(msg, 'control'):
                    event["control"] = msg.control
                if hasattr(msg, 'value'):
                    event["value"] = msg.value
                
                midi_events.append(event)
                
                # Print a clean version to terminal
                if msg.type == 'note_on' and msg.velocity > 0:
                    print(f"  -> Note ON: {msg.note} (Vel: {msg.velocity})")
                elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
                    pass # Keep terminal clean, just show hits
                else:
                    print(f"  -> MIDI: {msg.type}")
        else:
            while True:
                time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n[*] Stopping recording...")
    finally:
        recording = False
        if audio_stream:
            audio_stream.stop()
            audio_stream.close()
        audio_thread.join()
        
        if midi_port:
            midi_port.close()
            
        # Save MIDI JSON
        with open(MIDI_JSON_FILE, "w") as f:
            json.dump(midi_events, f, indent=2)
            
        print(f"[*] Saved {len(midi_events)} MIDI events.")
        print(f"[*] Vault updated: {VAULT_DIR}")
        print("[*] Exiting.")

if __name__ == "__main__":
    main()