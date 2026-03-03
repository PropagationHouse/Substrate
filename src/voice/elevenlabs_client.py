import base64
import json
import threading
import time
from typing import Callable, Optional

import numpy as np
import sounddevice as sd
import websocket
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse


DEFAULT_WS_ENDPOINT = "wss://api.elevenlabs.io/v1/convai/conversation"
DEFAULT_SAMPLE_RATE = 16000
DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"


class ElevenLabsClient:
    """Realtime ElevenLabs agent client handling mic streaming + agent audio."""

    def __init__(
        self,
        api_key: str,
        agent_id: str,
        voice_id: str = DEFAULT_VOICE_ID,
        endpoint: str = DEFAULT_WS_ENDPOINT,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        on_agent_audio: Optional[Callable[[bytes, int], None]] = None,
        on_transcript: Optional[Callable[[str, bool, str], None]] = None,
        on_status: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.api_key = api_key
        self.agent_id = agent_id
        self.voice_id = voice_id or DEFAULT_VOICE_ID
        self.endpoint = endpoint or DEFAULT_WS_ENDPOINT
        self.sample_rate = sample_rate
        self.on_agent_audio = on_agent_audio
        self.on_transcript = on_transcript
        self.on_status = on_status

        self._ws_app: Optional[websocket.WebSocketApp] = None
        self._ws_thread: Optional[threading.Thread] = None
        self._mic_stream: Optional[sd.InputStream] = None
        self._connected = threading.Event()
        self._running = False
        self._lock = threading.Lock()

    def start(self) -> None:
        if self._running:
            return
        if not self.api_key or not self.agent_id:
            raise RuntimeError("Missing ElevenLabs credentials")

        websocket.enableTrace(False)
        headers = {
            "xi-api-key": self.api_key,
            # WebSocket client uses list of header strings
        }

        ws_url = self._build_ws_url()

        self._ws_app = websocket.WebSocketApp(
            ws_url,
            header=[f"xi-api-key: {self.api_key}"],
            on_open=self._handle_open,
            on_message=self._handle_message,
            on_error=self._handle_error,
            on_close=self._handle_close,
        )

        self._running = True
        self._ws_thread = threading.Thread(
            target=self._ws_app.run_forever,
            kwargs={"ping_interval": 20, "ping_timeout": 10},
            daemon=True,
        )
        self._ws_thread.start()
        self._emit_status("connecting")

    def stop(self) -> None:
        with self._lock:
            self._running = False
        self._connected.clear()
        if self._mic_stream is not None:
            try:
                self._mic_stream.stop()
                self._mic_stream.close()
            except Exception:
                pass
            self._mic_stream = None
        if self._ws_app is not None:
            try:
                self._ws_app.close()
            except Exception:
                pass
            self._ws_app = None
        if self._ws_thread and self._ws_thread.is_alive():
            self._ws_thread.join(timeout=2)
        self._emit_status("stopped")

    def _handle_open(self, *_args) -> None:
        self._connected.set()
        self._emit_status("connected")
        init_payload = {
            "type": "conversation_initiation_client_data",
            "agent_id": self.agent_id,
            "user_input_audio_format": "pcm_16000",
            "conversation_config_override": {
                "agent": {
                    "language": "en",
                },
            },
        }
        self._send_json(init_payload)
        self._start_microphone()

    def _handle_close(self, *_args) -> None:
        self._connected.clear()
        if self._running:
            self._emit_status("disconnected")

    def _handle_error(self, _ws, error) -> None:
        self._emit_status(f"error: {error}")

    def _handle_message(self, _ws, message: str) -> None:
        try:
            payload = json.loads(message)
        except json.JSONDecodeError:
            return

        event_type = payload.get("type")
        if event_type in {"audio", "agent_output_audio_chunk"}:
            chunk = (
                payload.get("audio_event")
                or payload.get("agent_output_audio_chunk_event")
                or payload.get("agent_output_audio_chunk")
                or {}
            )
            audio_b64 = (
                chunk.get("audio_base_64")
                or chunk.get("audio_chunk")
                or chunk.get("audio")
            )
            if audio_b64 and self.on_agent_audio:
                try:
                    pcm_bytes = base64.b64decode(audio_b64)
                    self.on_agent_audio(pcm_bytes, self.sample_rate)
                except Exception:
                    pass
        elif event_type == "user_transcript":
            transcript_event = payload.get("user_transcription_event", {})
            transcript = transcript_event.get("user_transcript")
            is_final = transcript_event.get("is_final", True)
            if transcript and self.on_transcript:
                self.on_transcript(transcript, is_final, "user")
        elif event_type == "agent_response":
            agent_event = payload.get("agent_response_event", {})
            transcript = agent_event.get("agent_response")
            if transcript and self.on_transcript:
                self.on_transcript(transcript, True, "agent")

    def _start_microphone(self) -> None:
        if self._mic_stream is not None:
            return

        def callback(indata, _frames, _time_info, status):
            if status:
                return
            if not self._connected.is_set():
                return
            pcm = np.copy(indata).astype(np.int16).tobytes()
            encoded = base64.b64encode(pcm).decode("ascii")
            payload = {
                "type": "user_audio_chunk",
                "user_audio_chunk": encoded,
            }
            self._send_json(payload)

        self._mic_stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="int16",
            callback=callback,
        )
        self._mic_stream.start()
        self._emit_status("streaming")

    def _build_ws_url(self) -> str:
        parsed = urlparse(self.endpoint)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        query.setdefault("agent_id", self.agent_id)
        new_query = urlencode(query)
        return urlunparse(parsed._replace(query=new_query))

    def _send_json(self, payload: dict) -> None:
        if not self._ws_app:
            return
        try:
            self._ws_app.send(json.dumps(payload))
        except Exception:
            pass

    def _emit_status(self, status: str) -> None:
        if self.on_status:
            try:
                self.on_status(status)
            except Exception:
                pass
