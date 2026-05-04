#!/usr/bin/env bash
# End-to-end CLI flow analyzer.
#
# For each repo in the portfolio, sequentially:
#   1. Disk health check (abort if too tight)
#   2. Shallow clone
#   3. Run the full CLI suite (parse → analyze → context → diff → search →
#      communities → flows → update). Capture: exit code, duration, output
#      size, and a one-line summary per command.
#   4. Generate a per-repo markdown report with the matrix of results.
#   5. Delete the clone + all intermediate files.
#   6. Move to next.
#
# Designed for tight-disk machines: NEVER holds more than one clone at a time.
# Skip-if-already-validated semantics: a per-repo report at REPORTS_DIR/<slug>.md
# means "done, skip". Delete the report to force re-validation.
#
# Usage:
#   ./scripts/analyze-cli-flow.sh                       # full portfolio
#   ./scripts/analyze-cli-flow.sh --only spring-boot     # one repo
#   ./scripts/analyze-cli-flow.sh --only spring-boot,nestjs-nest
#   ./scripts/analyze-cli-flow.sh --keep-clones          # don't delete after
#   ./scripts/analyze-cli-flow.sh --min-free-gb 3        # disk floor (default 5)
#   ./scripts/analyze-cli-flow.sh --reports-dir DIR
#
# Output:
#   docs/cli-flow/<slug>.md   — per-repo full CLI flow report
#   docs/cli-flow/SUMMARY.md  — aggregate table

set -euo pipefail

ONLY_FILTER=""
KEEP_CLONES=false
MIN_FREE_GB=5
REPORTS_DIR="docs/cli-flow"
SCRATCH_DIR="/tmp/kodus-graph-cli-flow"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --only) ONLY_FILTER="$2"; shift 2 ;;
        --keep-clones) KEEP_CLONES=true; shift ;;
        --min-free-gb) MIN_FREE_GB="$2"; shift 2 ;;
        --reports-dir) REPORTS_DIR="$2"; shift 2 ;;
        --help|-h)
            sed -n 's/^# \?//p' "$0" | sed -n '1,/^$/p'
            exit 0
            ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

mkdir -p "$REPORTS_DIR" "$SCRATCH_DIR"

# Repo definitions. Format:
#   slug | url | language-key | file-glob | memory-mb
#
# - slug: directory + report filename
# - url: shallow-clone source
# - language-key: matches src/languages/support-matrix.ts `key` field
# - file-glob: pattern (relative to repo root) to find a source file for
#   --files-driven commands (analyze, context, diff). First match used.
# - memory-mb: --max-memory cap
REPOS=(
    "spring-boot|https://github.com/spring-projects/spring-boot|java|spring-boot-project/spring-boot/src/main/java/**/*.java|4096"
    "nestjs-nest|https://github.com/nestjs/nest|TypeScript|packages/core/**/*.ts|2048"
    "quarkus|https://github.com/quarkusio/quarkus|java|core/runtime/src/main/java/**/*.java|4096"
    "ktor|https://github.com/ktorio/ktor|kotlin|ktor-server/ktor-server-core/**/*.kt|2048"
    "fastapi|https://github.com/tiangolo/fastapi|python|fastapi/**/*.py|2048"
    "django|https://github.com/django/django|python|django/**/*.py|2048"
    "rails|https://github.com/rails/rails|ruby|activerecord/lib/**/*.rb|2048"
    "aspnetcore|https://github.com/dotnet/aspnetcore|csharp|src/**/*.cs|4096"
)

# Filter to --only list if provided.
declare -a TARGETS=()
if [[ -n "$ONLY_FILTER" ]]; then
    IFS=',' read -ra ONLY_LIST <<< "$ONLY_FILTER"
    for entry in "${REPOS[@]}"; do
        slug="${entry%%|*}"
        for wanted in "${ONLY_LIST[@]}"; do
            if [[ "$slug" == "$wanted" ]]; then
                TARGETS+=("$entry")
                break
            fi
        done
    done
else
    TARGETS=("${REPOS[@]}")
fi

# Helpers ────────────────────────────────────────────────────────────────────

free_gb() {
    df -g "$SCRATCH_DIR" | awk 'NR==2 {print $4}'
}

check_disk() {
    local free
    free=$(free_gb)
    if (( free < MIN_FREE_GB )); then
        echo "[disk] ${free}GB free < ${MIN_FREE_GB}GB floor — aborting." >&2
        exit 2
    fi
    echo "[disk] ${free}GB free."
}

# Time + run a command, capturing exit code, stderr, output file size.
# Args: <command-name> <output-file> <command-and-args...>
run_step() {
    local name="$1"; shift
    local out_file="$1"; shift
    local started exit_code stderr_log
    started=$(date +%s)
    stderr_log="$SCRATCH_DIR/$name.stderr"
    set +e
    "$@" 2> "$stderr_log"
    exit_code=$?
    set -e
    local duration=$(( $(date +%s) - started ))
    local size="0"
    if [[ -f "$out_file" ]]; then
        size=$(stat -f%z "$out_file" 2>/dev/null || echo 0)
    fi
    local err_count=0
    if [[ -f "$stderr_log" ]]; then
        err_count=$(awk '/^\[(WARN|ERROR)\]/ {n++} END {print n+0}' "$stderr_log")
    fi
    echo "${exit_code}|${duration}|${size}|${err_count}"
}

# Find the first file matching a glob pattern in the cloned repo.
find_target_file() {
    local repo_dir="$1"
    local pattern="$2"
    # Use find with the pattern's tail as a name match. Strips leading dirs
    # that ** cannot expand in pure shell — we approximate.
    local name_pattern
    name_pattern="${pattern##*/}"
    find "$repo_dir" -type f -name "$name_pattern" 2>/dev/null | head -1
}

# Process one repo end-to-end. ───────────────────────────────────────────────
process_repo() {
    local entry="$1"
    IFS='|' read -r slug url lang file_glob mem <<< "$entry"
    local report="$REPORTS_DIR/$slug.md"
    local clone_dir="$SCRATCH_DIR/$slug"
    local graph_path="$SCRATCH_DIR/$slug-graph.json"
    local analyze_out="$SCRATCH_DIR/$slug-analysis.json"
    local context_out="$SCRATCH_DIR/$slug-context.txt"
    local diff_out="$SCRATCH_DIR/$slug-diff.json"
    local search_out="$SCRATCH_DIR/$slug-search.json"
    local communities_out="$SCRATCH_DIR/$slug-communities.json"
    local flows_out="$SCRATCH_DIR/$slug-flows.json"

    if [[ -f "$report" ]]; then
        echo "[$slug] report exists, skipping."
        return 0
    fi

    echo
    echo "════════════════════════════════════════════════════════════════"
    echo "[$slug] start ($lang, ${mem}MB cap)"
    echo "════════════════════════════════════════════════════════════════"
    check_disk

    # Phase 1: clone
    if [[ -d "$clone_dir/.git" ]]; then
        echo "[$slug] clone exists, reusing."
    else
        echo "[$slug] cloning $url ..."
        if ! git clone --depth=1 --quiet "$url" "$clone_dir" 2>/dev/null; then
            echo "[$slug] CLONE FAILED — skipping."
            return 1
        fi
    fi

    # Phase 2: pick a file for --files commands
    local target_file
    target_file=$(find_target_file "$clone_dir" "$file_glob" || true)
    local target_rel=""
    if [[ -n "$target_file" ]]; then
        target_rel="${target_file#$clone_dir/}"
    fi
    echo "[$slug] target file: ${target_rel:-<none-found>}"

    # Phase 3: full CLI flow.
    # macOS bash 3.2 has no associative arrays — use parallel arrays.
    local cmd_names=(parse analyze context_prompt context_json diff search communities flows update)
    local cmd_results=()

    echo "[$slug] parse ..."
    cmd_results+=("$(run_step "$slug-parse" "$graph_path" \
        bun run src/cli.ts parse --all \
            --repo-dir "$clone_dir" \
            --out "$graph_path" \
            --max-memory "$mem" \
            --exclude '**/node_modules/**' '**/vendor/**' '**/.git/**' \
                      '**/target/**' '**/build/**' '**/dist/**' \
                      '**/__pycache__/**' '**/venv/**' '**/.venv/**')")

    if [[ -n "$target_rel" && -f "$graph_path" ]]; then
        echo "[$slug] analyze ..."
        cmd_results+=("$(run_step "$slug-analyze" "$analyze_out" \
            bun run src/cli.ts analyze \
                --files "$target_rel" \
                --graph "$graph_path" \
                --repo-dir "$clone_dir" \
                --out "$analyze_out")")

        echo "[$slug] context (prompt) ..."
        cmd_results+=("$(run_step "$slug-context-prompt" "$context_out" \
            bun run src/cli.ts context \
                --files "$target_rel" \
                --graph "$graph_path" \
                --repo-dir "$clone_dir" \
                --format prompt \
                --out "$context_out")")

        echo "[$slug] context (json) ..."
        local context_json="$SCRATCH_DIR/$slug-context.json"
        cmd_results+=("$(run_step "$slug-context-json" "$context_json" \
            bun run src/cli.ts context \
                --files "$target_rel" \
                --graph "$graph_path" \
                --repo-dir "$clone_dir" \
                --format json \
                --out "$context_json")")

        echo "[$slug] diff ..."
        cmd_results+=("$(run_step "$slug-diff" "$diff_out" \
            bun run src/cli.ts diff \
                --files "$target_rel" \
                --graph "$graph_path" \
                --repo-dir "$clone_dir" \
                --out "$diff_out")")
    else
        cmd_results+=("skip|0|0|0" "skip|0|0|0" "skip|0|0|0" "skip|0|0|0")
    fi

    if [[ -f "$graph_path" ]]; then
        echo "[$slug] search ..."
        cmd_results+=("$(run_step "$slug-search" "$search_out" \
            bun run src/cli.ts search \
                --graph "$graph_path" \
                --query '*' \
                --kind Method \
                --limit 50 \
                --out "$search_out")")

        echo "[$slug] communities ..."
        cmd_results+=("$(run_step "$slug-communities" "$communities_out" \
            bun run src/cli.ts communities \
                --graph "$graph_path" \
                --out "$communities_out")")

        echo "[$slug] flows ..."
        cmd_results+=("$(run_step "$slug-flows" "$flows_out" \
            bun run src/cli.ts flows \
                --graph "$graph_path" \
                --out "$flows_out")")

        echo "[$slug] update (no-op) ..."
        cmd_results+=("$(run_step "$slug-update" "$graph_path" \
            bun run src/cli.ts update \
                --repo-dir "$clone_dir" \
                --graph "$graph_path")")
    else
        cmd_results+=("skip|0|0|0" "skip|0|0|0" "skip|0|0|0" "skip|0|0|0")
    fi

    # Phase 4: extract metadata from graph for the report
    local td_summary=""
    local repo_files=""
    local repo_nodes=""
    local repo_edges=""
    if [[ -f "$graph_path" ]]; then
        repo_files=$(jq -r '.metadata.files_parsed' "$graph_path" 2>/dev/null || echo '?')
        repo_nodes=$(jq -r '.metadata.total_nodes' "$graph_path" 2>/dev/null || echo '?')
        repo_edges=$(jq -r '.metadata.total_edges' "$graph_path" 2>/dev/null || echo '?')
        td_summary=$(jq -r '.metadata.tier_distribution | "receiver=\(.receiver) di=\(.di) same=\(.same) import=\(.import) unique=\(.unique) ambig=\(.ambiguous) noise=\(.noise)"' "$graph_path" 2>/dev/null || echo '?')
    fi

    # Phase 5: write per-repo report
    {
        echo "# CLI flow validation: $slug"
        echo
        echo "- repo: \`$url\`"
        echo "- language: $lang"
        echo "- target file (for analyze/context/diff): \`${target_rel:-<none>}\`"
        echo "- max-memory: ${mem} MB"
        echo "- timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo
        echo "## Parse result"
        echo
        echo "- files_parsed: $repo_files"
        echo "- total_nodes: $repo_nodes"
        echo "- total_edges: $repo_edges"
        echo "- tier_distribution: $td_summary"
        echo
        echo "## CLI command results"
        echo
        echo "| Command | Exit | Duration (s) | Output bytes | Warnings/Errors |"
        echo "|---|---|---|---|---|"
        local n=${#cmd_names[@]}
        for ((i=0; i<n; i++)); do
            local cmd="${cmd_names[$i]}"
            local raw="${cmd_results[$i]:-0|0|0|0}"
            IFS='|' read -r exit_code duration size errs <<< "$raw"
            echo "| $cmd | $exit_code | $duration | $size | $errs |"
        done
        echo
        echo "## Notes"
        echo
        for cmd in "${cmd_names[@]}"; do
            local stderr_log="$SCRATCH_DIR/$slug-$cmd.stderr"
            if [[ -f "$stderr_log" ]]; then
                local first_warn
                first_warn=$(grep -m1 -E '^\[(WARN|ERROR)\]' "$stderr_log" 2>/dev/null | cut -c1-200 || true)
                if [[ -n "$first_warn" ]]; then
                    echo "- **$cmd**: $first_warn"
                fi
            fi
        done
    } > "$report"

    echo "[$slug] report → $report"

    # Phase 6: cleanup
    if [[ "$KEEP_CLONES" == "false" ]]; then
        echo "[$slug] cleanup ..."
        rm -rf "$clone_dir"
    fi
    rm -f "$graph_path" "$analyze_out" "$context_out" "$diff_out" \
          "$search_out" "$communities_out" "$flows_out" \
          "$SCRATCH_DIR/$slug-context.json" \
          "$SCRATCH_DIR/$slug-"*.stderr 2>/dev/null || true

    echo "[$slug] done."
}

# Main loop ──────────────────────────────────────────────────────────────────

echo "Targets: ${#TARGETS[@]} repos"
echo "Keep clones: $KEEP_CLONES"
echo "Disk floor: ${MIN_FREE_GB} GB"
echo

for entry in "${TARGETS[@]}"; do
    process_repo "$entry" || true
done

# Aggregate SUMMARY.md
SUMMARY="$REPORTS_DIR/SUMMARY.md"
{
    echo "# CLI flow — aggregate summary"
    echo
    echo "Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo
    echo "| Repo | Lang | Files | Nodes | Edges | Parse(s) | Failed cmds |"
    echo "|---|---|---|---|---|---|---|"
    for entry in "${TARGETS[@]}"; do
        IFS='|' read -r slug url lang file_glob mem <<< "$entry"
        local_report="$REPORTS_DIR/$slug.md"
        [[ -f "$local_report" ]] || continue
        local_files=$(grep -m1 'files_parsed:' "$local_report" | awk '{print $NF}')
        local_nodes=$(grep -m1 'total_nodes:' "$local_report" | awk '{print $NF}')
        local_edges=$(grep -m1 'total_edges:' "$local_report" | awk '{print $NF}')
        local_parse_dur=$(grep -m1 '| parse |' "$local_report" | awk -F'|' '{gsub(/ /,"",$4); print $4}')
        # Count rows where exit != 0 and != skip
        local_failed=$(awk -F'|' '/^\| (parse|analyze|context_|diff|search|communities|flows|update) /{gsub(/ /,"",$3); if ($3 != "0" && $3 != "skip") count++} END {print count+0}' "$local_report")
        echo "| $slug | $lang | $local_files | $local_nodes | $local_edges | $local_parse_dur | $local_failed |"
    done
} > "$SUMMARY"

echo
echo "════════════════════════════════════════════════════════════════"
echo "All done. Summary → $SUMMARY"
free_remaining=$(free_gb)
echo "Disk: ${free_remaining}GB free."
