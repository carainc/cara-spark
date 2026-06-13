#!/usr/bin/env bash
# voice-livekit-setup — create the BRAND-NEW cara-spark SIP inbound trunk + dispatch rule on the
# STANDALONE LiveKit server (Lane G, T13/tk-0013). Idempotent: safe to re-run.
#
# WHY a container: the `lk` CLI is NOT installed on the EC2 box. Instead of hand-rolling a LiveKit JWT
# and twirp calls in bash, we run a one-off `livekit/livekit-cli` container on the compose network —
# it mints its own token from LIVEKIT_API_KEY/LIVEKIT_API_SECRET and talks to http://livekit:7880
# (the SIP twirp endpoints — livekit.SIP/CreateSIPInboundTrunk + CreateSIPDispatchRule — are served by
# the LiveKit server). The `lk` CLI reads LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET from env.
#
# WHAT it creates (all NEW, project=cara-spark — never the prod cara-realtime resources):
#   • Inbound trunk  name=cara-spark-inbound, allowed_addresses=["52.203.137.71"]  → prints ST_…
#   • Dispatch rule  individual, roomPrefix=voicephone-, roomConfig.agents=[{agentName:cara-spark-cascade}]
#                    → prints SDR_…
# The worker registers under agentName=cara-spark-cascade (explicit dispatch), so a call that lands on
# the trunk mints a `voicephone-…` room and dispatches THIS worker — and only this worker — to it.
#
# ‼️ PROD ISOLATION (AGENTS.md OSS law #7): this NEVER references or reuses the prod trunk
#    ST_ogz3uBxbodYp, the prod rule SDR_zBaUyhWXoddU, or the prod line +14157180498. Standalone only.
#
# Usage:
#   scripts/voice-livekit-setup.sh
# Env (sensible local defaults; the box supplies real values via .env / compose):
#   LK_CLI_IMAGE   livekit-cli image           (default: livekit/livekit-cli:latest)
#   COMPOSE_NET    docker network to join      (default: cara-spark_default — compose's `name:` is cara-spark)
#   LIVEKIT_URL    server URL as seen on net   (default: ws://livekit:7880)
#   LIVEKIT_API_KEY / LIVEKIT_API_SECRET       (default: the local devkey pair; MUST match the server keys)
#   TRUNK_NAME     inbound trunk name          (default: cara-spark-inbound)
#   INBOUND_ADDR   allowed source address(es), comma-separated (default: 52.203.137.71)
#   VOICE_ROOM_PREFIX  dispatch room prefix    (default: voicephone-)
#   VOICE_AGENT_NAME   agent to dispatch       (default: cara-spark-cascade)
set -euo pipefail

LK_CLI_IMAGE="${LK_CLI_IMAGE:-livekit/livekit-cli:latest}"
COMPOSE_NET="${COMPOSE_NET:-cara-spark_default}"
LIVEKIT_URL="${LIVEKIT_URL:-ws://livekit:7880}"
LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-devkey}"
LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-lk_local_dev_only_min_32_chars_000000000}"
TRUNK_NAME="${TRUNK_NAME:-cara-spark-inbound}"
INBOUND_ADDR="${INBOUND_ADDR:-52.203.137.71}"
VOICE_ROOM_PREFIX="${VOICE_ROOM_PREFIX:-voicephone-}"
VOICE_AGENT_NAME="${VOICE_AGENT_NAME:-cara-spark-cascade}"

# Hard guard: refuse to run against any prod identifier, even if mis-wired via env.
case "${INBOUND_ADDR}:${TRUNK_NAME}:${VOICE_AGENT_NAME}" in
  *ST_ogz3uBxbodYp*|*SDR_zBaUyhWXoddU*|*14157180498*|*cara-realtime*|*cara-cascade*)
    echo "REFUSING: a prod LiveKit/Telnyx identifier is present — this script is standalone-only." >&2
    exit 2 ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found — this script runs the lk CLI via a one-off container." >&2
  exit 1
fi

# Temp request files, cleaned up on exit (one trap for both).
TRUNK_REQ="$(mktemp)"; RULE_REQ="$(mktemp)"
trap 'rm -f "$TRUNK_REQ" "$RULE_REQ"' EXIT

# Build the allowed_addresses JSON array from the comma-separated INBOUND_ADDR.
addr_json=$(printf '%s' "$INBOUND_ADDR" | awk -F, 'BEGIN{printf "["} {for(i=1;i<=NF;i++){gsub(/^ +| +$/,"",$i); printf "%s\"%s\"",(i>1?",":""),$i}} END{printf "]"}')

# run_lk <args...> — one-off lk container on the compose network, credentials via env. We pass
# --silent project json on stdin via env; the CLI auto-discovers the env-var project (no `lk project`).
run_lk() {
  docker run --rm --network "$COMPOSE_NET" \
    -e LIVEKIT_URL="$LIVEKIT_URL" \
    -e LIVEKIT_API_KEY="$LIVEKIT_API_KEY" \
    -e LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET" \
    "$LK_CLI_IMAGE" "$@"
}

# Extract an ID by prefix from arbitrary lk output (table or JSON). Prints the first match or nothing.
first_id() { grep -oE "$1[A-Za-z0-9]+" | head -n1 || true; }

echo "voice-livekit-setup: server=$LIVEKIT_URL net=$COMPOSE_NET image=$LK_CLI_IMAGE"
echo "  trunk=$TRUNK_NAME allowed_addresses=$addr_json  rule.prefix=$VOICE_ROOM_PREFIX agent=$VOICE_AGENT_NAME"

# ---------------------------------------------------------------------------
# 1) Inbound trunk (idempotent): reuse the existing cara-spark-inbound if present, else create it.
# ---------------------------------------------------------------------------
trunks_json="$(run_lk sip inbound list --json 2>/dev/null || true)"
# Find a trunk whose name == TRUNK_NAME and grab its sip_trunk_id (handles snake/camel JSON).
ST_ID="$(printf '%s' "$trunks_json" \
  | tr -d ' \t' \
  | grep -oE '\{[^{}]*"name":"'"$TRUNK_NAME"'"[^{}]*\}' \
  | first_id 'ST_' )"

if [ -n "$ST_ID" ]; then
  echo "  trunk exists -> $ST_ID (reusing)"
else
  cat > "$TRUNK_REQ" <<JSON
{ "trunk": { "name": "$TRUNK_NAME", "allowed_addresses": $addr_json } }
JSON
  # lk's create reads a CreateSIPInboundTrunkRequest (a {"trunk":{…}} wrapper) from a file path;
  # mount it read-only into the one-off container.
  create_out="$(docker run --rm --network "$COMPOSE_NET" \
    -e LIVEKIT_URL="$LIVEKIT_URL" -e LIVEKIT_API_KEY="$LIVEKIT_API_KEY" -e LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET" \
    -v "$TRUNK_REQ":/req.json:ro \
    "$LK_CLI_IMAGE" sip inbound create /req.json 2>&1)"
  echo "$create_out" | sed 's/^/    lk> /'
  ST_ID="$(printf '%s' "$create_out" | first_id 'ST_')"
  [ -n "$ST_ID" ] || { echo "FAILED to create inbound trunk." >&2; exit 1; }
  echo "  trunk created -> $ST_ID"
fi

# ---------------------------------------------------------------------------
# 2) Dispatch rule (idempotent): reuse an existing rule that targets our prefix, else create it.
# ---------------------------------------------------------------------------
rules_json="$(run_lk sip dispatch list --json 2>/dev/null || true)"
# A rule for our prefix already exists iff the (whitespace-stripped) listing contains roomPrefix ==
# VOICE_ROOM_PREFIX (protojson may emit either camelCase or snake_case). If so, take the first SDR_ id.
SDR_ID=""
rules_compact="$(printf '%s' "$rules_json" | tr -d ' \t')"
if printf '%s' "$rules_compact" | grep -qE '"(roomPrefix|room_prefix)":"'"$VOICE_ROOM_PREFIX"'"'; then
  SDR_ID="$(printf '%s' "$rules_compact" | first_id 'SDR_')"
fi

if [ -n "$SDR_ID" ]; then
  echo "  dispatch rule exists -> $SDR_ID (reusing; prefix=$VOICE_ROOM_PREFIX)"
else
  cat > "$RULE_REQ" <<JSON
{
  "dispatch_rule": {
    "rule": { "dispatchRuleIndividual": { "roomPrefix": "$VOICE_ROOM_PREFIX" } },
    "roomConfig": { "agents": [ { "agentName": "$VOICE_AGENT_NAME" } ] }
  }
}
JSON
  create_out="$(docker run --rm --network "$COMPOSE_NET" \
    -e LIVEKIT_URL="$LIVEKIT_URL" -e LIVEKIT_API_KEY="$LIVEKIT_API_KEY" -e LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET" \
    -v "$RULE_REQ":/rule.json:ro \
    "$LK_CLI_IMAGE" sip dispatch create /rule.json 2>&1)"
  echo "$create_out" | sed 's/^/    lk> /'
  SDR_ID="$(printf '%s' "$create_out" | first_id 'SDR_')"
  [ -n "$SDR_ID" ] || { echo "FAILED to create dispatch rule." >&2; exit 1; }
  echo "  dispatch rule created -> $SDR_ID"
fi

echo
echo "voice-livekit-setup: OK"
echo "  ST_  (inbound trunk)  = $ST_ID"
echo "  SDR_ (dispatch rule)  = $SDR_ID"
echo "  → point the Telnyx connection's inbound FQDN at the EC2 EIP:5060; calls mint ${VOICE_ROOM_PREFIX}… rooms"
echo "    dispatched to agentName=$VOICE_AGENT_NAME (the standalone worker)."
