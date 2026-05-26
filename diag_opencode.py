"""
Substrate Coding Tools Diagnostic
===================================
Run: python diag_opencode.py

Tests:
1. OpenCode CLI detection
2. Patch tool parse & validate
3. Tool registry on-demand loading
4. OpenCode headless run (live LLM call)
"""

import sys
import os
import time

# Ensure imports work from project root
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def header(msg):
    print(f"\n{'-'*60}")
    print(f"  {msg}")
    print(f"{'-'*60}")


def ok(msg):
    print(f"  [OK] {msg}")


def fail(msg):
    print(f"  [FAIL] {msg}")


def info(msg):
    print(f"    {msg}")


def main():
    print("=" * 60)
    print("  SUBSTRATE CODING TOOLS DIAGNOSTIC")
    print("=" * 60)

    passed = 0
    failed = 0

    # ── Test 1: OpenCode CLI Detection ──────────────────────────────
    header("[1/4] OpenCode CLI Detection")
    try:
        from src.tools.opencode_tool import opencode_dispatch

        result = opencode_dispatch("status")
        if result.get("cli_found"):
            ok(f"CLI found: {result['cli_path']}")
            passed += 1
        else:
            fail("CLI not found! Set OPENCODE_CLI env var or install OpenCode.")
            failed += 1

        info(f"Server running: {result.get('server_running', False)}")
        if result.get("server_running"):
            info(f"Server URL: {result.get('server_url')}")
    except Exception as e:
        fail(f"Import/execution error: {e}")
        failed += 1

    # ── Test 2: Patch Tool Parse & Validate ─────────────────────────
    header("[2/4] Patch Tool - Parse & Validate")
    try:
        from src.tools.patch_tool import apply_patch, _parse_unified_diff

        # Test parsing
        test_patch = (
            "--- a/src/example.py\n"
            "+++ b/src/example.py\n"
            "@@ -1,5 +1,6 @@\n"
            " import os\n"
            " import sys\n"
            "+import json\n"
            " \n"
            " def main():\n"
            "-    pass\n"
            "+    print('hello')\n"
        )
        parsed = _parse_unified_diff(test_patch)
        if parsed and len(parsed) == 1:
            fp = parsed[0]
            ok(f"Parsed: {fp['new_path']} with {len(fp['hunks'])} hunk(s)")
            info(f"Old path: {fp['old_path']}, New path: {fp['new_path']}")
            info(f"Lines in hunk: {len(fp['hunks'][0]['lines'])}")
            passed += 1
        else:
            fail(f"Parse failed: got {len(parsed)} file patches (expected 1)")
            failed += 1

        # Test multi-file parse
        multi_patch = (
            "--- a/file1.py\n"
            "+++ b/file1.py\n"
            "@@ -1 +1 @@\n"
            "-old1\n"
            "+new1\n"
            "--- a/file2.py\n"
            "+++ b/file2.py\n"
            "@@ -1 +1 @@\n"
            "-old2\n"
            "+new2\n"
        )
        parsed2 = _parse_unified_diff(multi_patch)
        if len(parsed2) == 2:
            ok(f"Multi-file parse: {len(parsed2)} files detected")
        else:
            fail(f"Multi-file parse: expected 2, got {len(parsed2)}")

        # Test dry-run on a real file
        real_patch = (
            "--- a/requirements.txt\n"
            "+++ b/requirements.txt\n"
            "@@ -1,2 +1,2 @@\n"
            " # Substrate Requirements\n"
            "-# Core\n"
            "+# Core Dependencies\n"
        )
        result = apply_patch(real_patch, dry_run=True)
        if result.get("status") == "success":
            ok(f"Dry-run on requirements.txt: {result['files_processed']} file(s) would be modified")
        else:
            info(f"Dry-run result: {result.get('status')} (errors: {result.get('errors', [])})")
            info("(This is OK if file content doesn't match the test patch)")

    except Exception as e:
        fail(f"Error: {e}")
        failed += 1

    # ── Test 3: Tool Registry On-Demand Loading ─────────────────────
    header("[3/4] Tool Registry - On-Demand Loading")
    try:
        from src.tools.tool_registry import get_tool_registry, load_contextual_tools

        reg = get_tool_registry()
        core_count = len(reg._tools)
        info(f"Core tools registered: {core_count}")

        # Test opencode keyword loading
        loaded1 = load_contextual_tools("I need to use the coding agent to refactor this", reg)
        if "opencode" in loaded1:
            ok("opencode loaded via keyword 'coding agent'")
            passed += 1
        elif "opencode" in reg._tools:
            ok("opencode already loaded")
            passed += 1
        else:
            fail("opencode NOT loaded after keyword trigger")
            failed += 1

        # Test patch keyword loading
        loaded2 = load_contextual_tools("apply this unified diff to the codebase", reg)
        if "patch" in loaded2:
            ok("patch loaded via keyword 'unified diff'")
            passed += 1
        elif "patch" in reg._tools:
            ok("patch already loaded")
            passed += 1
        else:
            fail("patch NOT loaded after keyword trigger")
            failed += 1

        info(f"Total tools after loading: {len(reg._tools)}")
        info(f"Tool list: {', '.join(sorted(reg._tools.keys()))}")

    except Exception as e:
        fail(f"Error: {e}")
        failed += 1

    # ── Test 4: OpenCode Headless Run ───────────────────────────────
    header("[4/4] OpenCode Headless Run (Live LLM)")
    try:
        from src.tools.opencode_tool import opencode_dispatch

        info("Sending: 'What is 2+2? Reply ONLY the number, nothing else.'")
        info("Timeout: 60 seconds...")
        start = time.time()

        result = opencode_dispatch(
            "run",
            prompt="What is 2+2? Reply ONLY the number, nothing else.",
            timeout_sec=60,
        )
        elapsed = time.time() - start

        status = result.get("status")
        if status == "success":
            output = result.get("output", "").strip()[:300]
            ok(f"OpenCode responded in {elapsed:.1f}s")
            info(f"Output: {output}")
            info(f"Events: {result.get('events_count', '?')}, Tool calls: {result.get('tool_calls_count', '?')}")
            if result.get("session_id"):
                info(f"Session: {result['session_id']}")
            passed += 1
        else:
            error = result.get("error", "unknown error")
            fail(f"OpenCode run failed ({elapsed:.1f}s): {error}")
            if result.get("stderr"):
                info(f"Stderr: {result['stderr'][:300]}")
            failed += 1

    except Exception as e:
        fail(f"Error: {e}")
        failed += 1

    # ── Summary ─────────────────────────────────────────────────────
    print()
    print("=" * 60)
    total = passed + failed
    if failed == 0:
        print(f"  ALL TESTS PASSED ({passed}/{total})")
    else:
        print(f"  {passed}/{total} passed, {failed} failed")
    print("=" * 60)

    # Usage examples
    print()
    print("  Usage examples (from Substrate's agent):")
    print()
    print('  opencode(action="run", prompt="Add error handling to proxy_server.py /api/chat")')
    print('  opencode(action="run", prompt="Refactor auth module", agent="build", model="anthropic/claude-sonnet-4-20250514")')
    print('  patch(action="apply", patch="--- a/foo.py\\n+++ b/foo.py\\n@@ -1 +1 @@\\n-old\\n+new")')
    print()

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
