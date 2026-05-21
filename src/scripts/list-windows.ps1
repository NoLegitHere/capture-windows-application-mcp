# list-windows.ps1 — Lists all visible windows with titles
# Output: JSON array of { "title", "processName", "processId", "mainWindowHandle" }

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$windows = Get-Process | Where-Object {
    $_.MainWindowTitle -and $_.MainWindowTitle.Trim() -ne ""
} | ForEach-Object {
    @{
        title            = $_.MainWindowTitle
        processName      = $_.ProcessName
        processId        = $_.Id
        mainWindowHandle = $_.MainWindowHandle.ToInt64()
    }
} | Sort-Object { $_.title }

$json = $windows | ConvertTo-Json -Compress
if (-not $json) {
    $json = "[]"
}
# Ensure it's always an array (single-item becomes object in PowerShell)
if ($json[0] -ne '[') {
    $json = "[$json]"
}
Write-Output $json
