#!/bin/sh
# Blocks any tool call that points at poc/. The Python POC stays unseen so new
# work is not biased by it. Checks paths and shell commands, not file contents.
# Limit: a Bash command that scans the whole repo (grep -r .) can still reach poc/; a sandbox deny rule would close that.
targets=$(jq -r '.tool_name as $t | .tool_input
  | [.file_path, .path, .notebook_path, .command, .glob, (if $t == "Glob" then .pattern else empty end)]
  | map(select(type == "string")) | join("\n")')
if printf '%s\n' "$targets" | grep -Eq "(^|[^A-Za-z0-9_.-])poc(/|[^A-Za-z0-9_.-]|\$)"; then
  echo "Blocked: poc/ is off limits. Do not read, search, run or edit anything in it." >&2
  exit 2
fi
exit 0
