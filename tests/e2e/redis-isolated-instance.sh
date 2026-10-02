#!/usr/bin/env bash
#
# Dedicated Redis for the real-queue E2E run.
#
# The application worker in Docker Compose consumes the same BullMQ queue as this
# suite, and it is connected to a different MongoDB database. It can therefore
# take an E2E job, fail to find the record the job names, and leave the E2E
# BackgroundJob stuck at `queued` forever. Nothing in the E2E environment can
# prevent that while both workers share one Redis, so the E2E gets its own.
#
# Started by playwright.config.ts as a webServer entry and probed on its port,
# never on an HTTP URL: Redis speaks no HTTP, and a readiness URL invented for it
# would be a fiction this suite then depended on.
#
# Teardown relies on Playwright's SIGTERM (see gracefulShutdown in the config).
# A run that is killed harder than that can leave the container behind, which is
# why the stale container is removed unconditionally at startup: a leftover from
# an aborted run can never make a later run start against the wrong instance.

set -euo pipefail

REDIS_PORT="${E2E_REDIS_PORT:-6380}"
CONTAINER_NAME="${E2E_REDIS_CONTAINER:-athenaeum_e2e_redis}"
REDIS_IMAGE="${E2E_REDIS_IMAGE:-redis:7-alpine}"

fail() {
  echo "e2e-redis: $1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is not on PATH, so the dedicated E2E Redis cannot be started."

docker info >/dev/null 2>&1 || fail "the Docker daemon is not reachable, so the dedicated E2E Redis cannot be started."

# A previous run that was killed before teardown leaves its container holding the
# port, and starting a second one would fail with an opaque bind error.
docker rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true

echo "e2e-redis: starting ${REDIS_IMAGE} on 127.0.0.1:${REDIS_PORT} as ${CONTAINER_NAME}"

if ! docker run --detach --rm \
  --name "$CONTAINER_NAME" \
  --publish "127.0.0.1:${REDIS_PORT}:6379" \
  "$REDIS_IMAGE" >/dev/null; then
  fail "could not start ${REDIS_IMAGE} on port ${REDIS_PORT}. Port ${REDIS_PORT} may already be in use by something other than this suite."
fi

shutdown() {
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  exit 0
}
trap shutdown SIGTERM SIGINT

# Playwright gates the run on this port accepting connections, so this wait is
# belt and braces: it makes a Redis that started but cannot serve fail here, with
# the container log, instead of surfacing later as jobs that never leave `queued`.
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER_NAME" redis-cli ping 2>/dev/null | grep -q PONG; then
    echo "e2e-redis: ready on 127.0.0.1:${REDIS_PORT}"
    break
  fi
  sleep 0.5
done

if ! docker exec "$CONTAINER_NAME" redis-cli ping 2>/dev/null | grep -q PONG; then
  docker logs "$CONTAINER_NAME" >&2 || true
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fail "the dedicated Redis did not become ready on port ${REDIS_PORT}."
fi

# Held open for the lifetime of the run. A loop rather than `sleep infinity`,
# which BSD sleep does not accept, and a backgrounded child plus `wait` so the
# SIGTERM trap above runs immediately instead of after the sleep finishes.
while true; do
  sleep 3600 &
  wait $!
done
