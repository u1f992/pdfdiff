#!/usr/bin/env bash

set -eEuo pipefail
shopt -s inherit_errexit
trap 'echo "Error on line $LINENO: $BASH_COMMAND (exit $?)" >&2' ERR

# Align the ubuntu user in the emscripten/emsdk image with the mounted
# workdir's owner so files we create are owned by the host user, and so we
# can write back into /workdir regardless of the host user's UID. Without
# this the script fails on hosts whose user is not UID 1000 (e.g. GitHub
# Actions' runner is UID 1001).
HOST_UID=$(stat --format='%u' /workdir)
HOST_GID=$(stat --format='%g' /workdir)
if [ "$HOST_UID" -ne 0 ] && [ "$HOST_UID" -ne "$(id -u ubuntu)" ]; then
  groupmod --non-unique --gid "$HOST_GID" ubuntu
  usermod --non-unique --uid "$HOST_UID" --gid "$HOST_GID" ubuntu
  chown --recursive "$HOST_UID:$HOST_GID" /home/ubuntu
fi

TARGET=${1:-all}

# clang-format / clang-tidy are only needed for the format and tidy targets
# and are not part of the emscripten/emsdk base image; install on demand.
case "$TARGET" in
format | tidy)
  DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -qq --yes --no-install-recommends \
    clang-format clang-tidy >/dev/null
  ;;
esac

exec runuser -u ubuntu -- bash -c "cd /workdir && make -C wasm $TARGET"
