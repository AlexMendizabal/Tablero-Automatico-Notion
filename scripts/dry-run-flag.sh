#!/usr/bin/env bash
# Classifies the action's dry-run input ($1) and prints the CLI flag to use.
#   true / 1 / yes (any case, ends trimmed)   -> prints "--dry-run"
#   false / 0 / no / empty                    -> prints nothing (real sync)
#   anything else                             -> exit 2 (fail closed)
# The raw value is never echoed: a newline in it would be read by the runner
# as another workflow command (::add-mask::, etc.).
set -euo pipefail

valor="$(printf '%s' "${1-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
case "${valor,,}" in
  true | 1 | yes) printf '%s' '--dry-run' ;;
  false | 0 | no | '') ;;
  *) exit 2 ;;
esac
