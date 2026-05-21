# capture-windows-application-mcp

Launch visible Windows applications, discover desktop windows, and capture PNG screenshots through a local Model Context Protocol server.

This repository is both an MCP server and a plugin bundle. The plugin includes a portable Agent Skill that teaches supported harnesses when to use the window capture tools.

## Features

- Launch a Windows `.exe`, wait for its visible window, and capture it.
- Reuse an existing visible process and capture by process ID.
- List visible desktop windows before selecting a capture target.
- Capture short multi-frame sequences with configurable intervals.
- Save PNGs to disk and return the last successful image inline.
- Optionally close a launched or reused process after capture.
- Package the MCP config and skill for plugin-aware agent harnesses.

## Requirements

- Windows 10 or Windows 11 with a visible desktop session.
- Node.js 18 or newer.
- PowerShell and .NET `System.Drawing`, available on standard Windows 10/11 installs.

This MCP captures local visible Windows UI. It is not useful in a headless runner or a remote cloud agent that cannot see the user's desktop.

## Build

Clone the repository, install locked dependencies, and build the TypeScript server:

```powershell
git clone https://github.com/NoLegitHere/capture-windows-application-mcp.git
cd capture-windows-application-mcp
npm ci
npm run build
```

The build produces `dist/index.js` and copies the PowerShell capture scripts into `dist/scripts/`.

## Plugin Bundle

The repo root is the plugin root:

```text
plugin.json
.mcp.json
.claude-plugin/plugin.json
.codex-plugin/plugin.json
skills/capture-windows-application/SKILL.md
```

The MCP server name is `capture-windows`. It exposes:

- `run_and_capture`
- `capture_window`
- `list_windows`

### GitHub Copilot CLI

Install the plugin directly from GitHub after the repository contains a built release or from a local built checkout:

```powershell
copilot plugin install NoLegitHere/capture-windows-application-mcp
```

For local plugin development:

```powershell
copilot plugin install .
```

Copilot CLI reads `plugin.json`, `skills/`, and `.mcp.json` from the plugin root.

### Claude Code

Add this repository as a plugin source and install the plugin after building it locally or from a packaged release:

```text
/plugin marketplace add NoLegitHere/capture-windows-application-mcp
```

The plugin includes `.claude-plugin/plugin.json`, `skills/`, and `.mcp.json`. Its MCP config uses the bundled `dist/index.js` entrypoint.

### Codex

Install or reference this repository as a Codex plugin. The `.codex-plugin/plugin.json` manifest points Codex at the bundled skill and MCP config.

The same skill is also kept installable as a standalone skill under `skills/capture-windows-application/` for harnesses that consume Agent Skills without the plugin wrapper.

### OpenCode

OpenCode discovers skills and MCP servers through its own project configuration. Build this repo, then export the skill and a local MCP config into an OpenCode project:

```powershell
.\scripts\install-opencode.ps1 -TargetRoot C:\path\to\your\opencode-project
```

The helper copies the skill into `.opencode/skills/capture-windows-application/` and writes `opencode.jsonc` with an absolute path to this repo's built `dist/index.js`.

## Manual MCP Configuration

Use the raw stdio MCP server when a client does not install plugins.

### Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "capture-windows": {
      "command": "node",
      "args": ["C:\\path\\to\\capture-windows-application-mcp\\dist\\index.js"]
    }
  }
}
```

### Cursor

Edit `.cursor/mcp.json` or the user-level Cursor MCP config:

```json
{
  "mcpServers": {
    "capture-windows": {
      "command": "node",
      "args": ["C:\\path\\to\\capture-windows-application-mcp\\dist\\index.js"]
    }
  }
}
```

### Generic stdio MCP Client

```powershell
node C:\path\to\capture-windows-application-mcp\dist\index.js
```

The server communicates over JSON-RPC on stdin/stdout.

## Tools

### `run_and_capture`

Launch an executable and capture its visible window.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `executable_path` | string | required | Full path to the `.exe` file |
| `arguments` | string[] | `[]` | Command-line arguments |
| `window_title` | string | none | Optional title filter for windows owned by the selected process |
| `wait_ms` | number | `3000` | Maximum time to wait for a visible window |
| `save_path` | string | `.screenshots/` | Directory or PNG file path for saved captures |
| `close_after` | boolean | `false` | Terminate the selected process after capture |
| `capture_count` | number | `1` | Number of screenshots to capture |
| `capture_interval_ms` | number | `2000` | Delay between multi-frame captures |

Behavior:

1. Check for an already-running visible process with the same executable name.
2. Capture the existing process by PID when possible.
3. Relaunch when existing-process capture fails.
4. Wait for a launched app window and capture the discovered PID.
5. Return the last successful screenshot inline and list saved capture paths.

### `capture_window`

Capture an already-running visible window.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `process_id` | number | none | Visible process ID to capture |
| `window_title` | string | none | Title fallback or process-local title filter |
| `save_path` | string | `.screenshots/` | Directory or PNG file path for the saved capture |

Prefer `process_id` from `list_windows`. Use title matching when a PID is unavailable or a process owns multiple visible windows.

### `list_windows`

List visible desktop windows with their titles, process names, and process IDs.

## Example Prompts

- `Run notepad and take a screenshot.`
- `List the visible Windows windows before choosing what to capture.`
- `Capture PID 1234 and save the PNG in this repo's .screenshots folder.`
- `Launch calculator, wait 5 seconds, capture 3 frames 2 seconds apart, then close it.`

## Automation

GitHub Actions builds the server on pushes and pull requests.

Release Please starts from version `1.0.0`, watches Conventional Commits on `main`, maintains a release PR, updates the Node package version, plugin manifest versions, and changelog, then creates the GitHub Release when that release PR is merged. The release workflow builds and attaches:

- an npm package tarball from `npm pack`
- a plugin ZIP containing the built server, skill, plugin manifests, MCP config, scripts, and docs

## How It Works

```text
Agent harness --stdio--> Node MCP server
                            |
                            |-- spawn --> target .exe
                            |
                            `-- PowerShell capture scripts
                                  |
                                  |-- user32 window discovery and focus
                                  `-- System.Drawing screenshot PNG
```

## License

MIT
