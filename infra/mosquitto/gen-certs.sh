#!/bin/sh
# Generates the development CA, broker certificate and client certificates for the MQTT broker.
# Runs as the one-shot `mqtt-certs` compose service. Output goes to infra/mosquitto/certs
# (gitignored). Existing files are kept, so certificates survive restarts.
#
# Client identities (the certificate CN becomes the MQTT username, see acl):
#   svc-ingest, svc-api, svc-health   cloud services
#   <siteId>                          one gateway per site (the simulator uses the demo site)
set -eu

OUT=/certs
DAYS=825
GATEWAY_SITES="${GATEWAY_SITES:-}"

have() { [ -f "$OUT/$1.crt" ] && [ -f "$OUT/$1.key" ]; }

if [ -f "$OUT/ca.crt" ] && have server && have svc-ingest && have svc-api && have svc-health; then
  missing=""
  for s in $GATEWAY_SITES; do have "gw-$s" || missing="$missing $s"; done
  [ -z "$missing" ] && { echo "certificates present"; exit 0; }
fi

command -v openssl >/dev/null 2>&1 || apk add --no-cache openssl >/dev/null

mkdir -p "$OUT"
cd "$OUT"

if [ ! -f ca.crt ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days "$DAYS" -subj "/CN=EcoManage Dev CA" -keyout ca.key -out ca.crt 2>/dev/null
fi

issue() { # name cn [san]
  name=$1 cn=$2 san=${3:-}
  have "$name" && return 0
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$cn" -keyout "$name.key" -out "$name.csr" 2>/dev/null
  if [ -n "$san" ]; then
    printf 'subjectAltName=%s\n' "$san" > "$name.ext"
    openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -days "$DAYS" -extfile "$name.ext" -out "$name.crt" 2>/dev/null
    rm -f "$name.ext"
  else
    openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -days "$DAYS" -out "$name.crt" 2>/dev/null
  fi
  rm -f "$name.csr"
  echo "issued $name (CN=$cn)"
}

issue server mosquitto "DNS:mosquitto,DNS:localhost,IP:127.0.0.1"
issue svc-ingest svc-ingest
issue svc-api svc-api
issue svc-health svc-health
for s in $GATEWAY_SITES; do issue "gw-$s" "$s"; done

# Development only: the broker runs as a non-root user and must read its key.
chmod 644 ./*.key ./*.crt
