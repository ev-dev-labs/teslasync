#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -f "$temp_dir/node" "$temp_dir/output"; rmdir "$temp_dir"' EXIT

cat > "$temp_dir/node" <<'NODE'
#!/usr/bin/env bash
case "$2" in
  requests)
    if [[ "${VERIFY_TEST_UNREGISTERED:-0}" == 1 ]]; then
      printf 'fixture.ts\t/unregistered\n'
    else
      printf 'fixture.ts\t/registered\n'
    fi
    ;;
  routes)
    printf '/registered\n'
    for ((i = 0; i < 200000; i++)); do printf '/filler/%s\n' "$i"; done
    ;;
  *) exit 2 ;;
esac
NODE
chmod +x "$temp_dir/node"

PATH="$temp_dir:$PATH" bash "$script_dir/verify.sh" fixture > "$temp_dir/output"
grep -Fq 'ALL EXTRACTED HOOK PATHS MATCH REGISTERED ROUTES' "$temp_dir/output"

if VERIFY_TEST_UNREGISTERED=1 PATH="$temp_dir:$PATH" bash "$script_dir/verify.sh" fixture > "$temp_dir/output"; then
  echo 'Expected an unregistered route to fail verification' >&2
  exit 1
fi
grep -Fq '/unregistered (NO MATCHING BACKEND ROUTE)' "$temp_dir/output"
echo 'Route verification handles large matches and reports missing routes.'
