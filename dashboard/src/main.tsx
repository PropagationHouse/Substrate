/**
 * main.tsx — Substrate Dashboard entry point.
 *
 * Mounts the React root and wraps the app in ErrorBoundary → StrictMode → AuthGate.
 * The auth gate checks `/api/auth/status` before rendering the main app.
 * When auth is disabled or the user is authenticated, the app renders normally.
 * When auth is enabled and the user is unauthenticated, the login page is shown.
 *
 * A global fetch interceptor injects the Authorization header so every /api/*
 * call carries the session token automatically.
 */
// NOTE: fetchInterceptor MUST be imported before AuthGate so it's active when
// useAuth's module-level auth check fires at import time.
import '@/lib/fetchInterceptor'
import { startTTSStreamListener } from '@/features/tts/ttsStreamPlayer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthGate } from '@/features/auth'

// Connect to Kokoro TTS WebSocket so voice audio plays on all clients
startTTSStreamListener();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <StrictMode>
      <AuthGate />
    </StrictMode>
  </ErrorBoundary>,
)
