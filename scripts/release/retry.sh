# Sourced by the release workflow: `retry <command...>` runs the command up to 4 times, sleeping 5,
# 15 and 30 seconds between attempts (GitHub's servers occasionally reject a push or an upload with
# a transient error). After the last attempt it fails with the command's exit code. Wrap several
# commands that must be repeated together in a shell function and retry that.
retry() {
  local delays=(5 15 30) attempt=1 status=0
  while true; do
    status=0
    "$@" || status=$?
    if [ "$status" -eq 0 ]; then
      return 0
    fi
    if [ "$attempt" -gt "${#delays[@]}" ]; then
      echo "::error::'$*' failed after ${attempt} attempts (exit ${status})."
      return "$status"
    fi
    echo "::warning::'$*' failed (exit ${status}), attempt ${attempt} of $(( ${#delays[@]} + 1 )); retrying in ${delays[$((attempt - 1))]}s."
    sleep "${delays[$((attempt - 1))]}"
    attempt=$((attempt + 1))
  done
}
