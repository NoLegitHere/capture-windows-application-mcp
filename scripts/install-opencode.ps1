param(
  [string]$TargetRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$pluginRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$targetRootFull = [System.IO.Path]::GetFullPath($TargetRoot)
$skillSource = Join-Path $pluginRoot "skills\capture-windows-application"
$skillDestinationRoot = Join-Path $targetRootFull ".opencode\skills"
$skillDestination = Join-Path $skillDestinationRoot "capture-windows-application"
$configPath = Join-Path $targetRootFull "opencode.jsonc"
$serverEntry = Join-Path $pluginRoot "dist\index.js"

if (-not (Test-Path -LiteralPath $serverEntry)) {
  throw "Build the MCP first with 'npm ci' and 'npm run build'. Missing: $serverEntry"
}

New-Item -ItemType Directory -Force -Path $skillDestinationRoot | Out-Null
Copy-Item -LiteralPath $skillSource -Destination $skillDestinationRoot -Recurse -Force

$nodePath = $serverEntry.Replace("\", "\\")
$config = @"
{
  "`$schema": "https://opencode.ai/config.json",
  "mcp": {
    "capture-windows": {
      "type": "local",
      "command": ["node", "$nodePath"],
      "enabled": true
    }
  }
}
"@

Set-Content -LiteralPath $configPath -Value $config -Encoding utf8

Write-Output "Installed OpenCode skill at $skillDestination"
Write-Output "Wrote OpenCode MCP config at $configPath"
