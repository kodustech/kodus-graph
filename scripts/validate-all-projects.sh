#!/usr/bin/env bash
# Validate kodus-graph against a curated set of real-world repos.
#
# Usage:
#   ./scripts/validate-all-projects.sh [--mode minimal|full] [--clones-dir DIR] [--reports-dir DIR]
#
# Default mode is `minimal` (~3GB clones, 7 repos covering all key features).
# `full` mode (~15GB) clones the entire portfolio.
#
# Skips repos that are already cloned. Idempotent — re-run after a code change
# to refresh reports.
#
# Outputs:
#   - <clones-dir>/<repo-slug>/  : shallow git clone (--depth=1)
#   - <reports-dir>/<repo-slug>.md : per-repo markdown report
#   - <reports-dir>/SUMMARY.md   : aggregate table across all repos
#
# Memory: Java/Kotlin/large-Scala repos use 4096 MB cap; others use 2048.
# Add new repos by appending to the REPOS array below.

set -euo pipefail

MODE="minimal"
CLONES_DIR="${HOME}/Documents/kodus-git/projects-trd-validation"
REPORTS_DIR="docs/language-validation/real-repos"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode) MODE="$2"; shift 2 ;;
        --clones-dir) CLONES_DIR="$2"; shift 2 ;;
        --reports-dir) REPORTS_DIR="$2"; shift 2 ;;
        --help|-h)
            sed -n 's/^# \?//p' "$0" | sed -n '1,/^$/p'
            exit 0
            ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

mkdir -p "$CLONES_DIR" "$REPORTS_DIR"

# Repo definitions. Format: slug | url | language-key | memory-mb | mode
# - slug: directory name + report filename
# - url: shallow-clone source (use https for public repos)
# - language-key: matches src/languages/support-matrix.ts `key` field
# - memory-mb: --max-memory cap; bump for large Java/Kotlin repos
# - mode: 'minimal' (always cloned) or 'full' (only with --mode full)
REPOS=(
    # ── Minimal viable: covers all v0.4.0 features ─────────────────────────
    "spring-boot|https://github.com/spring-projects/spring-boot|java|4096|minimal"
    "nestjs-nest|https://github.com/nestjs/nest|TypeScript|2048|minimal"
    "quarkus|https://github.com/quarkusio/quarkus|java|4096|minimal"
    "ktor|https://github.com/ktorio/ktor|kotlin|2048|minimal"
    "fastapi|https://github.com/tiangolo/fastapi|python|2048|minimal"
    "django|https://github.com/django/django|python|2048|minimal"
    "rails|https://github.com/rails/rails|ruby|2048|minimal"
    "aspnetcore|https://github.com/dotnet/aspnetcore|csharp|4096|minimal"

    # ── Full portfolio: language-by-language coverage ───────────────────────
    "tanstack-query|https://github.com/TanStack/query|TypeScript|2048|full"
    "next-js|https://github.com/vercel/next.js|TypeScript|4096|full"
    "flask|https://github.com/pallets/flask|python|2048|full"
    "mockito|https://github.com/mockito/mockito|java|2048|full"
    "exposed|https://github.com/JetBrains/Exposed|kotlin|2048|full"
    "arrow|https://github.com/arrow-kt/arrow|kotlin|2048|full"
    "gin|https://github.com/gin-gonic/gin|go|2048|full"
    "terraform|https://github.com/hashicorp/terraform|go|4096|full"
    "ripgrep|https://github.com/BurntSushi/ripgrep|rust|2048|full"
    "efcore|https://github.com/dotnet/efcore|csharp|4096|full"
    "vapor|https://github.com/vapor/vapor|swift|2048|full"
    "nlohmann-json|https://github.com/nlohmann/json|cpp|2048|full"
    "playframework|https://github.com/playframework/playframework|scala|2048|full"
    "ecto|https://github.com/elixir-ecto/ecto|elixir|2048|full"
    "symfony|https://github.com/symfony/symfony|php|4096|full"
    "jekyll|https://github.com/jekyll/jekyll|ruby|2048|full"
    "git|https://github.com/git/git|c|2048|full"
)

# Resolve which repos to act on.
declare -a TARGETS=()
for entry in "${REPOS[@]}"; do
    IFS='|' read -r slug url lang mem repo_mode <<< "$entry"
    if [[ "$MODE" == "full" || "$repo_mode" == "minimal" ]]; then
        TARGETS+=("$entry")
    fi
done

echo "Mode: $MODE — ${#TARGETS[@]} repos targeted."
echo "Clones dir: $CLONES_DIR"
echo "Reports dir: $REPORTS_DIR"
echo

# Phase 1: clone (skip if exists).
for entry in "${TARGETS[@]}"; do
    IFS='|' read -r slug url lang mem repo_mode <<< "$entry"
    target_dir="$CLONES_DIR/$slug"
    if [[ -d "$target_dir/.git" ]]; then
        echo "[clone] $slug — already present, skipping."
    else
        echo "[clone] $slug ← $url"
        git clone --depth=1 --quiet "$url" "$target_dir" || {
            echo "[clone] $slug FAILED — continuing"
            continue
        }
    fi
done
echo

# Phase 2: validate.
declare -a SUCCESSES=()
declare -a FAILURES=()
for entry in "${TARGETS[@]}"; do
    IFS='|' read -r slug url lang mem repo_mode <<< "$entry"
    target_dir="$CLONES_DIR/$slug"
    report="$REPORTS_DIR/$slug.md"
    if [[ ! -d "$target_dir" ]]; then
        echo "[validate] $slug — clone missing, skipping."
        FAILURES+=("$slug:clone-missing")
        continue
    fi
    echo "[validate] $slug ($lang, ${mem}MB max)"
    if bun run scripts/validate-language.ts \
        --repo "$target_dir" \
        --lang "$slug" \
        --out "$report" \
        --max-memory "$mem"; then
        SUCCESSES+=("$slug")
    else
        FAILURES+=("$slug:validate-failed")
    fi
    echo
done

# Phase 3: aggregate summary.
SUMMARY="$REPORTS_DIR/SUMMARY.md"
{
    echo "# Real-repo validation summary"
    echo
    echo "Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Mode: $MODE"
    echo
    echo "| Repo | Lang | Status | Resolved | Ambig | Receiver/1k | High-conf |"
    echo "|---|---|---|---|---|---|---|"
    for slug in "${SUCCESSES[@]}"; do
        report="$REPORTS_DIR/$slug.md"
        [[ -f "$report" ]] || continue
        # Extract verdict + headline numbers from each report.
        status=$(grep -oE '🟢 PASS|🟡 GAP|PARSE FAILED' "$report" | head -1 || echo '?')
        lang=$(grep -m1 '^- repo:' "$report" | sed 's/.*- repo: //' || echo '')
        resolved=$(grep -oE 'resolved ratio[^*]*\*\*[0-9.]+%' "$report" | grep -oE '[0-9.]+%' | head -1 || echo '?')
        ambig=$(grep -oE 'ambigRatio [0-9.]+' "$report" | head -1 | awk '{print $2}' || echo '?')
        recv=$(awk '/^## tier_distribution/,/^## Quality signals/' "$report" | grep -oE '\| receiver \| [0-9]+' | awk '{print $4}' || echo '?')
        highconf=$(grep -oE 'high-confidence CALLS[^(]*\(\*\*[0-9.]+%' "$report" | grep -oE '[0-9.]+%' | head -1 || echo '?')
        echo "| $slug | $lang | $status | $resolved | $ambig | $recv | $highconf |"
    done
    if [[ ${#FAILURES[@]} -gt 0 ]]; then
        echo
        echo "## Failures"
        echo
        for f in "${FAILURES[@]}"; do
            echo "- $f"
        done
    fi
} > "$SUMMARY"

echo "===================="
echo "Done."
echo "  ${#SUCCESSES[@]} succeeded, ${#FAILURES[@]} failed."
echo "  Summary: $SUMMARY"
