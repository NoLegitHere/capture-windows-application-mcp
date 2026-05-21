import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Get the MCP server's project root directory (parent of dist/).
 * This is where .screenshots/ lives by default.
 */
export function getServerRootDir(): string {
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  // On Windows, URL pathname starts with /C:/..., strip the leading /
  const normalized = process.platform === "win32" ? thisDir.slice(1) : thisDir;
  // dist/ → project root
  return path.resolve(normalized, "..");
}

/**
 * Resolve the output path for a screenshot file.
 * If savePath is provided and is a directory, generates a filename inside it.
 * If savePath is a full file path, uses it directly.
 * If savePath is not provided, defaults to .screenshots/ in the MCP server's
 * own project root — NOT process.cwd(), since MCP clients launch the server
 * from unpredictable working directories.
 */
export function resolveOutputPath(
  windowTitle: string,
  savePath?: string
): string {
  const filename = generateFilename(windowTitle);

  if (savePath) {
    // If it looks like a directory (no extension or ends with separator)
    if (
      !path.extname(savePath) ||
      savePath.endsWith(path.sep) ||
      savePath.endsWith("/")
    ) {
      return path.resolve(savePath, filename);
    }
    // It's a full file path
    return path.resolve(savePath);
  }

  // Default: .screenshots/ in the MCP server's own project root
  return path.resolve(getServerRootDir(), ".screenshots", filename);
}

/**
 * Generate a timestamped filename from a window title.
 * e.g., "Calculator" → "calculator_2025-01-15_143022.png"
 */
export function generateFilename(windowTitle: string): string {
  const sanitized = windowTitle
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase()
    .substring(0, 60);

  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  return `${sanitized}_${timestamp}.png`;
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 * If the directory is (or is inside) a .screenshots folder, auto-create
 * a .gitignore with "*" so screenshots never get committed to git.
 */
export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });

  // Find the .screenshots ancestor and drop a .gitignore in it
  const screenshotsDir = findScreenshotsAncestor(dirPath);
  if (screenshotsDir) {
    const gitignorePath = path.join(screenshotsDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, "*\n", "utf-8");
    }
  }
}

/**
 * Walk up from dirPath to find a directory named ".screenshots".
 */
function findScreenshotsAncestor(dirPath: string): string | null {
  let current = path.resolve(dirPath);
  const root = path.parse(current).root;

  while (current !== root) {
    if (path.basename(current) === ".screenshots") {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

/**
 * Get the directory of the currently running script (for locating bundled PS1 files).
 */
export function getScriptsDir(): string {
  // In ESM, import.meta.url gives us the file URL
  // We resolve relative to the compiled dist/ directory
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  // On Windows, URL pathname starts with /C:/..., strip the leading /
  const normalized = process.platform === "win32" ? thisDir.slice(1) : thisDir;
  return path.join(normalized, "scripts");
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
