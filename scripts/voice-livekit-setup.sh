#!/usr/bin/env bash
# voice-livekit-setup — create the BRAND-NEW cara-spark SIP inbound trunk + dispatch rule on the
# STANDALONE LiveKit server (Lane G, T13/tk-0013). Idempotent: safe to re-run.
#
# WHY a container: the `lk` CLI is NOT installed on the EC2 box. We run a one-off
# `livekit/livekit-cli` container on the compose network; it mints its own token from
# LIVEKIT_API_KEY/LIVEKIT_API_SECRET and talks to ws://livekit:7880 (the LiveKit SIP twirp API).
#
# WHAT it creates (all NEW, project=cara-spark — never the prod cara-realtime resources):
#   • Inbound trunk  name=cara-spark-inbound-did, numbers=["<DID>"]  → matches calls TO the DID from
#     ANY source (the EC2 security group is the firewall; matching by source-IP fails because Telnyx
#     calls originate from Telnyx's IPs, not the box). Prints ST_…
#   • Dispatch rule  individual, roomPrefix=voicephone-, roomConfig.agents=[{agentName:cara-spark-cascade}]
#     → mints voicephone-… rooms and EXPLICIT-dispatches the standalone worker. Prints SDR_…
#
# ‼️ PROD ISOLATION (AGENTS.md OSS law #7): NEVER references/reuses the prod trunk ST_ogz3uBxbodYp,
#    the prod rule SDR_zBaUyhWXoddU, the prod agent cara-realtime, or the prod line +14157180498.
#
# NOTE: `set -e` is deliberately OFF — `lk … list` piped through grep returns non-zero on an empty
# list, which is normal and must not abort the (idempotent) script. We check IDs explicitly instead.
set -uo pipefail

LK_CLI_IMAGE="${LK_CLI_IMAGE:-livekit/livekit-cli:latest}"
COMPOSE_NET="${COMPOSE_NET:-cara-spark_default}"
LIVEKIT_URL="${LIVEKIT_URL:-ws://livekit:7880}"
LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-devkey}"
LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-lk_local_dev_only_min_32_chars_000000000}"
TRUNK_NAME="${TRUNK_NAME:-cara-spark-inbound-did}"
INBOUND_NUMBER="${INBOUND_NUMBER:-+16674643821}"
VOICE_ROOM_PREFIX="${VOICE_ROOM_PREFIX:-voicephone-}"
VOICE_AGENT_NAME="${VOICE_AGENT_NAME:-cara-spark-cascade}"

# Hard guard: refuse to run against any prod identifier, even if mis-wired via env.
case "${INBOUND_NUMBER}:${TRUNK_NAME}:${VOICE_AGENT_NAME}" in
  *ST_ogz3uBxbodYp*|*SDR_zBaUyhWXoddU*|*14157180498*|*cara-realtime*)
    echo "REFUSING: a prod LiveKit/Telnyx identifier is present — this script is standalone-only." >&2
    exit 2 ;;
esac
command -v docker >/dev/null 2>&1 || { echo "docker not found — needed to run the lk CLI container." >&2; exit 1; }

lk()  { sudo docker run --rm --network "$COMPOSE_NET" -e LIVEKIT_URL="$LIVEKIT_URL" -e LIVEKIT_API_KEY="$LIVEKIT_API_KEY" -e LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET" "$LK_CLI_IMAGE" "$@"; }
lkf() { local h="$1" c="$2"; shift 2; sudo docker run --rm --network "$COMPOSE_NET" -e LIVEKIT_URL="$LIVEKIT_URL" -e LIVEKIT_API_KEY="$LIVEKIT_API_KEY" -e LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET" -v "$h":"$c":ro "$LK_CLI_IMAGE" "$@"; }
idof() { grep -oE "$1[A-Za-z0-9]+" | head -n1 || true; }

echo "voice-livekit-setup: server=$LIVEKIT_URL net=$COMPOSE_NET trunk=$TRUNK_NAME number=$INBOUND_NUMBER agent=$VOICE_AGENT_NAME"

# 1) Inbound trunk (idempotent by name) — DID-matched, any source.
ST_ID="$(lk sip inbound list 2>/dev/null | grep -F "$TRUNK_NAME" | idof 'ST_')"
if [ -n "$ST_ID" ]; then
  echo "  trunk exists -> $ST_ID (reusing)"
else
  TREQ="$(mktemp)"; printf '{ "trunk": { "name": "%s", "numbers": ["%s"] } }\n' "$TRUNK_NAME" "$INBOUND_NUMBER" > "$TREQ"
  out="$(lkf "$TREQ" /req.json sip inbound create /req.json 2>&1)"; rm -f "$TREQ"
  echo "$out" | sed 's/^/    lk> /'
  ST_ID="$(printf '%s' "$out" | idof 'ST_')"
  [ -n "$ST_ID" ] || { echo "FAILED to create inbound trunk." >&2; exit 1; }
  echo "  trunk created -> $ST_ID"
fi

# 2) Dispatch rule (idempotent by room prefix) — mint voicephone-… rooms + explicit-dispatch worker.
SDR_ID="$(lk sip dispatch list 2>/dev/null | grep -F "$VOICE_ROOM_PREFIX" | idof 'SDR_')"
if [ -n "$SDR_ID" ]; then
  echo "  dispatch rule exists -> $SDR_ID (reusing; prefix=$VOICE_ROOM_PREFIX)"
else
  RREQ="$(mktemp)"; printf '{ "dispatch_rule": { "rule": { "dispatchRuleIndividual": { "roomPrefix": "%s" } }, "roomConfig": { "agents": [ { "agentName": "%s" } ] } } }\n' "$VOICE_ROOM_PREFIX" "$VOICE_AGENT_NAME" > "$RREQ"
  out="$(lkf "$RREQ" /rule.json sip dispatch create /rule.json 2>&1)"; rm -f "$RREQ"
  echo "$out" | sed 's/^/    lk> /'
  SDR_ID="$(printf '%s' "$out" | idof 'SDR_')"
  [ -n "$SDR_ID" ] || { echo "FAILED to create dispatch rule." >&2; exit 1; }
  echo "  dispatch rule created -> $SDR_ID"
fi

echo
echo "voice-livekit-setup: OK"
echo "  ST_  (inbound trunk)  = $ST_ID   (matches DID $INBOUND_NUMBER, any source)"
echo "  SDR_ (dispatch rule)  = $SDR_ID  (room ${VOICE_ROOM_PREFIX}… → agent $VOICE_AGENT_NAME)"
echo "  → point the Telnyx connection's inbound FQDN at the EC2 EIP:5060; calls to $INBOUND_NUMBER"
echo "    mint ${VOICE_ROOM_PREFIX}… rooms dispatched to the standalone worker."
