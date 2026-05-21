---
name: capture-windows-application
description: Use the capture-windows MCP to launch Windows executables, discover visible desktop windows, and capture application screenshots. Use when an agent needs to inspect or verify a native Windows app window, capture a running process by PID or title, or take multiple frames from a launched executable during local Windows UI validation.
---

# Capture Windows Application

Use the `capture-windows` MCP for native Windows desktop screenshots. Prefer it for local `.exe` windows that browser tools cannot inspect.

## Load The MCP

Use the configured MCP server named `capture-windows`. Harnesses may prefix MCP tool names differently, but this server exposes:

- `list_windows`: discover visible desktop windows and their process IDs.
- `capture_window`: capture an already-running visible window by `process_id` or by `window_title`.
- `run_and_capture`: launch an executable, wait for its window, capture one or more screenshots, and optionally close it.

If these tools are unavailable, ask the harness to configure or enable this repo's local MCP server before claiming the window was inspected.

## Choose A Tool

1. Use `list_windows` first when the target app is already open or the title is uncertain.
2. Use `capture_window` with `process_id` from `list_windows` whenever possible. Use `window_title` as a fallback or as a filter inside the selected process.
3. Use `run_and_capture` when the task should launch a specific `.exe`. Pass a full `executable_path`; add `arguments`, `window_title`, and a larger `wait_ms` when startup or title matching needs it.
4. Use `capture_count` and `capture_interval_ms` for a short visual sequence. The MCP returns the last successful capture inline and reports saved paths for the capture set.
5. Set `close_after` only when the launched or reused process should be terminated after capture.

## Capture Workflow

For an open app:

1. List windows.
2. Select the visible window by process name, title, and PID.
3. Capture by PID.
4. Inspect the inline image or the saved PNG path before claiming a visual result.

For an app to launch:

1. Resolve the executable path from the repo, build output, or known Windows path.
2. Call `run_and_capture`.
3. Increase `wait_ms` if the process starts before its window becomes visible.
4. Add `window_title` when one executable can own multiple visible windows.
5. Inspect the returned image before reporting visual verification.

## Guardrails

- This MCP captures visible Windows desktop windows. It is not a DOM inspector and cannot validate hidden or headless UI.
- Prefer a user-provided or workspace-local `save_path` when the screenshot artifact should stay with the task. Without it, screenshots are saved under the MCP server's `.screenshots` folder.
- Treat `run_and_capture` as potentially reusing an already-running process with the same executable. Review `close_after` before enabling it.
- If capture fails because no window appears, use `list_windows`, inspect the actual title and PID, and retry with a better title filter or longer wait.
