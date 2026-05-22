#!/usr/bin/env bash
set -euo pipefail

# No-op for repos that use the shared skills pre-commit hook but do not
# maintain local agent-config backups.
exit 0
