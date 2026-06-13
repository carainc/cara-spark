# syntax=docker/dockerfile:1
# agent-worker image — the Cara Spark standalone voice cascade (Lane G, T13/tk-0013).
#
# The worker is a REAL @livekit/agents worker: it registers under VOICE_AGENT_NAME for EXPLICIT SIP
# dispatch and runs the cascade Deepgram STT -> Opus 4.8 brain (engine-gated) -> Deepgram Aura TTS.
#
# Plugins: @livekit/agents-plugin-deepgram (STT + Aura TTS) and @livekit/agents-plugin-silero (VAD)
# are the Node plugins this worker needs. There is NO Node Anthropic plugin (only Python ships one),
# so the Opus 4.8 brain runs via the official @anthropic-ai/sdk, called from the agent's llmNode —
# which is also the seam where the deterministic engine gates every disposition (model NEVER decides).
#
# ISOLATION: targets the STANDALONE LiveKit via LIVEKIT_URL/KEY/SECRET — NEVER the prod cara-realtime
# stack. No prod trunk/rule/agent/number is referenced anywhere in this image.
FROM node:22-slim

# ffmpeg backs the audio resampling some plugins use; ca-certificates for outbound TLS (Deepgram, API).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg

WORKDIR /app

# Install the agent runtime + plugins as a standalone module (the worker is its own package; it does
# NOT share the Next app's node_modules). Versions track the verified @livekit/agents v1.x line.
COPY worker/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY worker/ ./worker/

# Long-lived worker process. It registers with LiveKit and waits for explicitly-dispatched rooms.
# The `start` subcommand is REQUIRED: @livekit/agents' cli.runApp() is a commander CLI whose
# subcommands are start|dev|connect|download-files; with NO subcommand it prints --help and exits
# (the crash-loop this image previously hit). `start` runs the worker in production mode. (index.mjs
# also defaults argv to `start` if omitted, so this is explicit-and-belt-and-suspenders.)
CMD ["node", "worker/index.mjs", "start"]
