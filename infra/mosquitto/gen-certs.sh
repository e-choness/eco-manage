#!/bin/sh
# Generates the development CA, broker certificate and client certificates for the MQTT broker.
# Runs as the one-shot `mqtt-certs` compose service. Output goes to infra/mosquitto/certs
# (gitignored). Existing files are kept, so certificates survive restarts.
#
# Client identities (the certificate CN becomes the MQTT username, see acl):
#   svc-ingest, svc-api, svc-rules,   cloud services
#   svc-health
#   <siteId>                          one gateway per site (the simulator uses the demo site)
#   bootstrap                         shared by gateways not yet claimed (P5-04): may only use
#                                     claim/<client id>/…; claiming issues the site certificate
set -eu

OUT=/certs
DAYS=825
GATEWAY_SITES="${GATEWAY_SITES:-}"

have() { [ -f "$OUT/$1.crt" ] && [ -f "$OUT/$1.key" ]; }

if [ -f "$OUT/ca.crt" ] && have server && have svc-ingest && have svc-api && have svc-rules && have svc-health && have bootstrap; then
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

# MQTT_SERVER_SAN adds names gateways use from outside, e.g. "DNS:mqtt.example.com,IP:203.0.113.7".
issue server mosquitto "DNS:mosquitto,DNS:localhost,IP:127.0.0.1${MQTT_SERVER_SAN:+,$MQTT_SERVER_SAN}"
issue svc-ingest svc-ingest
issue svc-api svc-api
issue svc-rules svc-rules
issue svc-health svc-health
issue bootstrap bootstrap
for s in $GATEWAY_SITES; do issue "gw-$s" "$s"; done

# Development only: the broker runs as a non-root user and must read its key.
chmod 644 ./*.key ./*.crt
