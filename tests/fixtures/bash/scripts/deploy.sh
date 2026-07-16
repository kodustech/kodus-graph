#!/usr/bin/env bash
source ./util.sh

build() {
  log_info "building"
}

deploy() {
  build
  retry
  log_info "deployed"
}

deploy
