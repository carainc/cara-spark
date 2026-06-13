// agent-worker — stub that BOOTS so the full stack comes up at Phase 0. Lane G (T13/T10)
// replaces this with the LiveKit agent: explicit SIP dispatch, Deepgram STT (en/es) →
// Opus 4.8 cascade → Aura TTS, posting a no-PHI policy decision back to the app.
console.log('[agent-worker] cara-spark voice worker stub ready — Lane G (T13/T10) implements the cascade.');
setInterval(() => {}, 1 << 30);
