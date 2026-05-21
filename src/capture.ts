import { execFile, spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { resolveOutputPath, ensureDir, getScriptsDir, sleep } from "./utils.js";

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────

export interface CaptureResult {
  success: boolean;
  path: string;
  base64: string;
  width: number;
  height: number;
  error: string;
}

export interface WindowInfo {
  title: string;
  processName: string;
  processId: number;
  mainWindowHandle: number;
}

interface ExistingProcess {
  processId: number;
  windowTitle?: string;
}

export interface RunAndCaptureOptions {
  executablePath: string;
  arguments?: string[];
  windowTitle?: string;
  waitMs?: number;
  savePath?: string;
  closeAfter?: boolean;
  captureCount?: number;
  captureIntervalMs?: number;
}

// ─── PowerShell Escaping ─────────────────────────────────────────────

/**
 * Escape a string for safe use inside a PowerShell single-quoted string.
 * In PowerShell, the only character that needs escaping in single-quoted
 * strings is the single quote itself, which is doubled: ' → ''
 */
function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Encode a PowerShell command as base64 UTF-16LE for use with -EncodedCommand.
 * This completely bypasses all CMD and PowerShell escaping issues.
 */
function encodePowerShellCommand(command: string): string {
  const buffer = Buffer.from(command, "utf16le");
  return buffer.toString("base64");
}

// ─── PowerShell Execution ────────────────────────────────────────────

/**
 * Execute a PowerShell script and return its stdout.
 */
async function runPowerShell(
  scriptPath: string,
  args: string[]
): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...args,
    ],
    {
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for base64 images
      timeout: 30000,
    }
  );

  if (stderr && stderr.trim()) {
    console.error(`[PowerShell stderr]: ${stderr.trim()}`);
  }

  return stdout.trim();
}

// ─── Window Listing ──────────────────────────────────────────────────

/**
 * List all visible windows with their titles and process info.
 */
export async function listWindows(): Promise<WindowInfo[]> {
  const scriptPath = path.join(getScriptsDir(), "list-windows.ps1");
  const output = await runPowerShell(scriptPath, []);

  try {
    const windows: WindowInfo[] = JSON.parse(output);
    return windows;
  } catch {
    throw new Error(`Failed to parse window list: ${output}`);
  }
}

// ─── Window Capture ──────────────────────────────────────────────────

/**
 * Capture a screenshot of a window by its title.
 */
export async function captureWindow(
  windowTitle: string,
  savePath?: string,
  bringToFront: boolean = true
): Promise<CaptureResult> {
  return captureTarget({ windowTitle, savePath, bringToFront });
}

/**
 * Capture a screenshot of a visible window owned by a process id.
 * The optional window title is only used to disambiguate multiple windows
 * inside that same process; it is never matched across unrelated processes.
 */
export async function captureWindowByProcessId(
  processId: number,
  savePath?: string,
  bringToFront: boolean = true,
  windowTitle?: string
): Promise<CaptureResult> {
  return captureTarget({ processId, windowTitle, savePath, bringToFront });
}

async function captureTarget(options: {
  windowTitle?: string;
  processId?: number;
  savePath?: string;
  bringToFront: boolean;
}): Promise<CaptureResult> {
  const { windowTitle, processId, savePath, bringToFront } = options;
  if (processId === undefined && !windowTitle) {
    throw new Error("Either window title or process id is required for capture.");
  }

  const targetName = windowTitle || `process_${processId}`;
  const outputPath = resolveOutputPath(targetName, savePath);
  ensureDir(path.dirname(outputPath));

  const scriptPath = path.join(getScriptsDir(), "capture.ps1");
  const args = ["-SavePath", outputPath];

  if (processId !== undefined) {
    args.push("-ProcessId", String(processId));

    if (windowTitle) {
      args.push("-WindowTitle", windowTitle);
    }
  } else if (windowTitle) {
    args.push("-WindowTitle", windowTitle, "-PartialMatch");
  }

  if (bringToFront) {
    args.push("-BringToFront");
  }

  const output = await runPowerShell(scriptPath, args);

  try {
    const result: CaptureResult = JSON.parse(output);
    return result;
  } catch {
    throw new Error(`Failed to parse capture result: ${output}`);
  }
}

// ─── Process Detection ───────────────────────────────────────────────

/**
 * Check if a process matching the given executable name is already running.
 * Returns its process id so capture does not depend on title matching.
 */
async function findExistingProcess(
  executablePath: string,
  windowTitle?: string
): Promise<ExistingProcess | null> {
  const exeName = path.basename(executablePath, path.extname(executablePath));
  const escapedExeName = escapePowerShellString(exeName);
  const escapedExecutablePath = escapePowerShellString(
    path.resolve(executablePath)
  );
  const escapedWindowTitle = escapePowerShellString(windowTitle ?? "");

  const command = `
$targetPath = '${escapedExecutablePath}'
$titleFilter = '${escapedWindowTitle}'
$processes = Get-Process -Name '${escapedExeName}' -ErrorAction SilentlyContinue | Where-Object {
  $_.MainWindowHandle -ne 0 -and
  $_.MainWindowTitle -and
  ([string]::IsNullOrWhiteSpace($titleFilter) -or $_.MainWindowTitle.IndexOf($titleFilter, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
}
$match = $processes | Where-Object {
  try {
    $_.Path -and [string]::Equals($_.Path, $targetPath, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    $false
  }
} | Select-Object -First 1
if (-not $match) {
  $match = $processes | Select-Object -First 1
}
if ($match) {
  [pscustomobject]@{
    processId = $match.Id
    windowTitle = $match.MainWindowTitle
  } | ConvertTo-Json -Compress
}
`;

  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodePowerShellCommand(command),
    ]);
    const output = stdout.trim();
    if (!output) {
      return null;
    }

    const processInfo = JSON.parse(output) as ExistingProcess;
    return typeof processInfo.processId === "number" ? processInfo : null;
  } catch {
    return null;
  }
}

/**
 * Kill a process by id.
 */
async function killProcessById(processId: number): Promise<void> {
  const command = `Stop-Process -Id ${processId} -Force -ErrorAction SilentlyContinue`;

  try {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodePowerShellCommand(command),
    ]);
    // Give it a moment to fully terminate
    await sleep(500);
  } catch {
    // Ignore errors — process may already be gone
  }
}

// ─── Launch & Capture ────────────────────────────────────────────────

/**
 * Launch an executable, wait for its window, and capture screenshots.
 * Implements smart process reuse:
 *   1. Check if process is already running → capture existing window
 *   2. If capture fails → kill it, relaunch, capture
 *   3. If not running → launch, wait, capture
 */
export async function runAndCapture(
  options: RunAndCaptureOptions
): Promise<{ captures: CaptureResult[]; processId?: number }> {
  const {
    executablePath,
    arguments: args = [],
    windowTitle,
    waitMs = 3000,
    savePath,
    closeAfter = false,
    captureCount = 1,
    captureIntervalMs = 2000,
  } = options;

  const exeName = path.basename(
    executablePath,
    path.extname(executablePath)
  );
  const searchTitle = windowTitle || exeName;

  let launchedProcess: ChildProcess | undefined;
  let captures: CaptureResult[] = [];

  // Step 1: Check if process is already running
  const existingProcess = await findExistingProcess(executablePath, windowTitle);

  if (existingProcess) {
    // Try to capture the existing window
    try {
      const result = await captureWindowByProcessId(
        existingProcess.processId,
        savePath,
        true,
        windowTitle
      );
      if (result.success) {
        captures.push(result);

        // Multi-frame captures
        for (let i = 1; i < captureCount; i++) {
          await sleep(captureIntervalMs);
          const nextResult = await captureWindowByProcessId(
            existingProcess.processId,
            savePath,
            false,
            windowTitle
          );
          captures.push(nextResult);
        }

        if (closeAfter) {
          await killProcessById(existingProcess.processId);
        }

        return { captures, processId: existingProcess.processId };
      }
    } catch {
      // Capture failed on existing process — kill and relaunch
    }

    // Kill the existing process and relaunch
    await killProcessById(existingProcess.processId);
  }

  // Step 2: Launch the process
  launchedProcess = spawn(executablePath, args, {
    detached: true,
    stdio: "ignore",
  });
  launchedProcess.unref();

  const processId = launchedProcess.pid;
  if (processId === undefined) {
    throw new Error(`Failed to launch '${executablePath}': no process id returned.`);
  }

  // Step 3: Wait for window to appear
  const startTime = Date.now();
  let foundWindow: WindowInfo | null = null;

  while (Date.now() - startTime < waitMs) {
    await sleep(500);

    // Prefer the launched process id. Some Windows apps hand the visible UI
    // to a new process, so fall back to the same executable name and then
    // capture by the discovered PID.
    const windows = await listWindows();
    const lowerSearchTitle = searchTitle.toLowerCase();
    const titleMatches = (window: WindowInfo) =>
      !windowTitle || window.title.toLowerCase().includes(lowerSearchTitle);
    const matchByPid = windows.find(
      (w) =>
        w.processId === processId &&
        titleMatches(w)
    );
    const match =
      matchByPid ??
      windows.find(
        (w) =>
          w.processName.toLowerCase() === exeName.toLowerCase() &&
          titleMatches(w)
      );

    if (match) {
      foundWindow = match;
      break;
    }
  }

  if (!foundWindow) {
    return {
      captures: [
        {
          success: false,
          path: "",
          base64: "",
          width: 0,
          height: 0,
          error: `Window not found after ${waitMs}ms. Process '${exeName}' may not have a visible window yet. Try increasing wait_ms.`,
        },
      ],
      processId,
    };
  }

  // Give the window a moment to fully render
  await sleep(500);

  // Step 4: Capture screenshots
  for (let i = 0; i < captureCount; i++) {
    if (i > 0) {
      await sleep(captureIntervalMs);
    }

    const result = await captureWindowByProcessId(
      foundWindow.processId,
      savePath,
      i === 0, // Only bring to front on first capture
      windowTitle
    );
    captures.push(result);
  }

  // Step 5: Close if requested
  if (closeAfter && processId) {
    await killProcessById(foundWindow.processId);
  }

  return { captures, processId: foundWindow.processId };
}
