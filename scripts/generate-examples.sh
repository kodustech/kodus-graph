#!/usr/bin/env bash
#
# Regenerate examples/ — the output the README points at as "real output from
# running kodus-graph".
#
# These were hand-generated once and then drifted. The committed set predated
# schema 2.0, and it was produced WITHOUT a baseline graph, so every function
# showed up as `new | 0 callers` and every import as `⚠ UNRESOLVED`: it showcased
# the fallback path, not the one the tool exists for.
#
# So this reproduces the real flow instead — parse a baseline, apply a contract
# change, diff it, ask for context. `AuthService.verifyToken` gains a parameter
# and turns async, which is the canonical case: the signature changes, the
# callers don't, and only the graph knows who breaks.
#
#   ./scripts/generate-examples.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

CLI="$REPO_ROOT/src/cli.ts"
FIXTURE="$REPO_ROOT/tests/fixtures/sample-repo"
OUT="$REPO_ROOT/examples"
GRAPH="$OUT/parse-output.json"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -R "$FIXTURE/." "$WORK/"

# Show stderr and stop on failure. A silently skipped example is how these drifted
# in the first place — three commands here don't take --repo-dir, and the original
# script swallowed the error.
run() {
    if ! bun run "$CLI" "$@" 2>"$WORK/err"; then
        echo "FAILED: $*" >&2
        cat "$WORK/err" >&2
        exit 1
    fi
}

echo "→ parse --all (baseline)"
run parse --all --repo-dir "$WORK" --out "$GRAPH"

echo "→ apply contract change: verifyToken gains a param and turns async"
python3 - "$WORK/src/auth.ts" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = 'verifyToken(token: string): boolean {\n    return token.length > 0;\n  }'
new = ('verifyToken(token: string, opts: VerifyOpts): Promise<boolean> {\n'
       '    return Promise.resolve(token.length > 0 && opts.strict);\n  }')
if old not in s:
    raise SystemExit(f'{p}: verifyToken no longer matches the expected shape — update this script')
open(p, 'w').write(s.replace(old, new))
PY

diff -u "$FIXTURE/src/auth.ts" "$WORK/src/auth.ts" \
    | sed -e '1s|.*|--- a/src/auth.ts|' -e '2s|.*|+++ b/src/auth.ts|' \
    > "$WORK/change.diff" || true

echo "→ analyze --files src/auth.ts"
run analyze --files src/auth.ts --graph "$GRAPH" --repo-dir "$WORK" --out "$OUT/analyze-output.json"

for fmt in json prompt xml; do
    case "$fmt" in
        json) dest="$OUT/context-output.json" ;;
        prompt) dest="$OUT/context-prompt-output.txt" ;;
        xml) dest="$OUT/context-xml-output.xml" ;;
    esac
    echo "→ context --format $fmt"
    run context --files src/auth.ts --graph "$GRAPH" --diff "$WORK/change.diff" \
        --repo-dir "$WORK" --format "$fmt" --out "$dest"
done

echo "→ diff --files src/auth.ts"
run diff --files src/auth.ts --graph "$GRAPH" --repo-dir "$WORK" --out "$OUT/diff-output.json"

# search, flows and communities read the graph only — no --repo-dir.
echo "→ search --query 'auth*'"
run search --query 'auth*' --graph "$GRAPH" --out "$OUT/search-output.json"

echo "→ flows"
run flows --graph "$GRAPH" --out "$OUT/flows-output.json"

echo "→ communities"
run communities --graph "$GRAPH" --out "$OUT/communities-output.json"

# The baseline was parsed from a temp workdir; rewrite repo_dir so the committed
# example doesn't carry a machine-specific path.
python3 - "$GRAPH" "$FIXTURE" "$REPO_ROOT" <<'PY'
import json, sys
graph, fixture, root = sys.argv[1], sys.argv[2], sys.argv[3]
g = json.load(open(graph))
g['metadata']['repo_dir'] = fixture.replace(root + '/', '')
json.dump(g, open(graph, 'w'), indent=2)
PY

echo
echo "Done. Review the diff before committing — these files are the README's showcase."
