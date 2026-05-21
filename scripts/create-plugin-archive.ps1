$ErrorActionPreference = "Stop"

$pluginFiles = @(
  "dist",
  "skills",
  "scripts",
  ".claude-plugin",
  ".codex-plugin",
  ".mcp.json",
  "plugin.json",
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE"
)

Compress-Archive -Path $pluginFiles -DestinationPath "capture-windows-application-plugin.zip" -Force
