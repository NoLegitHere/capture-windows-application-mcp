$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$verifyRoot = Join-Path $repoRoot ".screenshots\package-verify"
$extractRoot = Join-Path $verifyRoot "plugin-zip"
$isolatedRoot = Join-Path ([System.IO.Path]::GetTempPath()) "capture-windows-application-plugin-package-verify"

function Remove-VerifiedTree([string]$Path, [string]$ExpectedParent) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  $parentPath = [System.IO.Path]::GetFullPath($ExpectedParent)
  if (-not $resolvedPath.StartsWith($parentPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove '$resolvedPath' outside '$parentPath'."
  }

  Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

Push-Location $repoRoot
try {
  New-Item -ItemType Directory -Force -Path $verifyRoot | Out-Null
  Remove-VerifiedTree $extractRoot $verifyRoot
  Remove-VerifiedTree $isolatedRoot ([System.IO.Path]::GetTempPath())

  & (Join-Path $PSScriptRoot "create-plugin-archive.ps1")
  Expand-Archive -LiteralPath "capture-windows-application-plugin.zip" -DestinationPath $extractRoot -Force
  Copy-Item -LiteralPath $extractRoot -Destination $isolatedRoot -Recurse

  foreach ($requiredPath in @(
    "dist\index.js",
    "dist\scripts\capture.ps1",
    "dist\scripts\list-windows.ps1",
    "skills\capture-windows-application\SKILL.md",
    "plugin.json",
    ".mcp.json"
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $isolatedRoot $requiredPath))) {
      throw "Plugin archive is missing '$requiredPath'."
    }
  }

  $process = Start-Process -FilePath "node" `
    -ArgumentList @(".\dist\index.js") `
    -WorkingDirectory $isolatedRoot `
    -PassThru `
    -WindowStyle Hidden
  Start-Sleep -Seconds 1

  if ($process.HasExited) {
    throw "Packaged MCP exited during isolated startup with code $($process.ExitCode)."
  }

  Stop-Process -Id $process.Id -Force
  Write-Output "Verified isolated plugin archive startup from $isolatedRoot"
} finally {
  Pop-Location
}
