/**
 * ttsStreamPlayer — Plays Kokoro TTS audio on all clients (desktop + mobile).
 *
 * Listens for `voice-audio` events that arrive through the gateway WebSocket
 * (the same WebSocket that delivers chat messages — already proven to work).
 * When Kokoro finishes generating speech, voice_handler.py sends a
 * `{ type: "voice-audio", url: "/audio/combined_audio_xxx.wav" }` message
 * via `send_message_to_frontend`, which gets broadcast to all connected
 * gateway WS clients. We fetch the WAV file and play it via HTMLAudioElement.
 */

let currentAudio: HTMLAudioElement | null = null;

function emitEmotion(emotion: string) {
  window.dispatchEvent(new CustomEvent('substrate:agent-emotion', {
    detail: { status: emotion, emotion }
  }));
}

/**
 * Handle a voice-audio event from the gateway WebSocket.
 * Called from wherever gateway events are processed.
 */
export function handleVoiceAudioEvent(url: string) {
  if (!url) return;
  console.log('[TTS] Playing voice audio:', url);

  // Stop any currently playing audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }

  // Fetch the audio file — use fetch() so the interceptor adds the
  // server URL prefix (for Capacitor) and auth token automatically
  fetch(url)
    .then(resp => {
      if (!resp.ok) throw new Error(`Failed to fetch audio: ${resp.status}`);
      return resp.blob();
    })
    .then(blob => {
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      currentAudio = audio;

      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(objectUrl);
        currentAudio = null;
        emitEmotion('idle');
      }, { once: true });

      audio.addEventListener('error', () => {
        console.error('[TTS] Audio playback error');
        URL.revokeObjectURL(objectUrl);
        currentAudio = null;
        emitEmotion('idle');
      }, { once: true });

      emitEmotion('speaking');
      return audio.play();
    })
    .catch(err => {
      console.error('[TTS] Failed to play voice audio:', err);
      emitEmotion('idle');
    });
}

/**
 * Start listening for voice-audio events.
 * Uses a CustomEvent bridge — gateway event handlers dispatch
 * 'substrate:voice-audio' when they see type === 'voice-audio'.
 */
export function startTTSStreamListener() {
  // Unlock audio on first user gesture (required by mobile browsers)
  if (typeof document !== 'undefined') {
    const events = ['click', 'touchstart', 'keydown'] as const;
    const handler = () => {
      // Create and immediately pause a silent audio to unlock playback
      try {
        const a = new Audio();
        a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
        a.play().then(() => a.pause()).catch(() => {});
      } catch { /* ignore */ }
      events.forEach(e => document.removeEventListener(e, handler, true));
    };
    events.forEach(e => document.addEventListener(e, handler, { capture: true, once: false }));
  }

  // Listen for voice-audio events dispatched from the gateway event handler
  window.addEventListener('substrate:voice-audio', ((e: CustomEvent) => {
    const url = e.detail?.url;
    if (url) handleVoiceAudioEvent(url);
  }) as EventListener);

  console.log('[TTS] Voice audio listener started');
}
