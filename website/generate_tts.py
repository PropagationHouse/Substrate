"""Generate TTS WAV files for the website demo mode explanations using Kokoro."""
import os
import sys
import wave
import numpy as np

# Add parent dir to path so we can import kokoro
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from kokoro import KPipeline
import torch

device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"Using device: {device}")
pipeline = KPipeline(lang_code='a', device=device)

VOICE = 'af_heart'
SPEED = 1.0
SAMPLE_RATE = 24000
OUT_DIR = os.path.join(os.path.dirname(__file__), 'audio')
os.makedirs(OUT_DIR, exist_ok=True)

texts = {
    'code': (
        "In Code mode I act on your instructions immediately, "
        "executing commands, writing files, browsing the web, and controlling your desktop in real time. "
        "I can run shell commands and scripts on your OS, read, write, and manage files across your system, "
        "browse the web, scrape data, and take screenshots, "
        "send messages to Obsidian, Notion, or any integrated app, "
        "and chain multiple tools together in a single response. "
        "This is the default mode. Tell me what to do and I'll do it."
    ),
    'ask': (
        "In Ask mode I answer questions using my knowledge, your files, and web search, "
        "without executing any commands or modifying anything. "
        "I can explain code, concepts, or errors, search the web and summarize findings, "
        "read and analyze your local files, and reference your conversation history and memory. "
        "Think of it as a research assistant that looks but doesn't touch."
    ),
    'plan': (
        "In Plan mode I break down complex tasks into structured steps before executing anything. "
        "I will analyze what you're asking for, outline each step with the tools I'll use, "
        "show you the full plan for approval, and execute step by step once confirmed. "
        "Best for multi-step workflows, project scaffolding, or anything you want to review before I act."
    ),
}

for name, text in texts.items():
    print(f"\nGenerating: {name}")
    generator = pipeline(text, voice=VOICE, speed=SPEED)
    
    segments = []
    for gs, ps, audio in generator:
        if isinstance(audio, torch.Tensor):
            audio = audio.detach().cpu().numpy()
        segments.append((audio * 32767).astype(np.int16))
    
    combined = np.concatenate(segments)
    outpath = os.path.join(OUT_DIR, f'mode_{name}.wav')
    with wave.open(outpath, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(combined.tobytes())
    
    print(f"  Saved: {outpath} ({len(combined)/SAMPLE_RATE:.1f}s)")

print("\nDone! Audio files saved to website/audio/")
