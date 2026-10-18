#!/bin/sh
# actions/upload-pages-artifact requires GNU tar as `gtar` on macOS.
set -eu

add_brew_path() {
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    if [ -n "${GITHUB_PATH:-}" ]; then
      echo /opt/homebrew/bin >> "$GITHUB_PATH"
    fi
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
    if [ -n "${GITHUB_PATH:-}" ]; then
      echo /usr/local/bin >> "$GITHUB_PATH"
    fi
  fi
}

add_brew_path

if command -v gtar >/dev/null 2>&1; then
  exit 0
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Missing GNU tar (gtar)." >&2
  echo "Install Homebrew on this Mac mini, then: brew install gnu-tar" >&2
  echo "actions/upload-pages-artifact requires gtar on self-hosted macOS." >&2
  exit 1
fi

brew list gnu-tar >/dev/null 2>&1 || brew install gnu-tar
add_brew_path

if ! command -v gtar >/dev/null 2>&1; then
  echo "brew install gnu-tar did not put gtar on PATH" >&2
  exit 1
fi
