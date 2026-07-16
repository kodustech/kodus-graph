#!/usr/bin/env bash

log_info() {
  echo "[INFO] $1"
}

retry() {
  local n=0
  while [ $n -lt 3 ]; do
    if run_once; then
      return 0
    fi
    n=$((n + 1))
  done
  return 1
}

run_once() {
  echo "trying"
}
