#!/usr/bin/env node

/**
 * capture-windows-application-mcp
 *
 * MCP server that launches Windows executables, captures their window
 * screenshots, and returns images to LLM IDE/CLI harnesses.
 *
 * Tools:
 *   - run_and_capture: Launch exe → wait for window → capture screenshot(s)
 *   - capture_window:  Capture an already-running window by process id or title
 *   - list_windows:    List all visible windows
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  runAndCapture,
  captureWindow,
  captureWindowByProcessId,
  listWindows,
  type CaptureResult,
} from "./capture.js";

// ─── Server Setup ────────────────────────────────────────────────────

const server = new McpServer({
  name: "capture-windows-application",
  version: "1.0.0",
});

// ─── Tool: run_and_capture ───────────────────────────────────────────

server.tool(
  "run_and_capture",
  "Launch a Windows executable, wait for its window to appear, and capture a screenshot. " +
    "If the process is already running, captures the existing window. " +
    "If capture fails on the existing process, kills it and relaunches. " +
    "Supports multi-frame capture with configurable intervals. " +
    "Returns the screenshot as an inline image and saves it to disk.",
  {
    executable_path: z
      .string()
      .describe(
        "Full path to the .exe file to launch (e.g., 'C:\\\\Windows\\\\notepad.exe')"
      ),
    arguments: z
      .array(z.string())
      .optional()
      .describe("Command-line arguments to pass to the executable"),
    window_title: z
      .string()
      .optional()
      .describe(
        "Optional title filter for windows owned by the target process."
      ),
    wait_ms: z
      .number()
      .optional()
      .default(3000)
      .describe(
        "Maximum time in milliseconds to wait for the window to appear (default: 3000)"
      ),
    save_path: z
      .string()
      .optional()
      .describe(
        "Directory or file path to save the screenshot. Defaults to .screenshots/ in the MCP server's install directory"
      ),
    close_after: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Whether to kill the process after capturing all screenshots (default: false)"
      ),
    capture_count: z
      .number()
      .optional()
      .default(1)
      .describe("Number of screenshots to capture (default: 1)"),
    capture_interval_ms: z
      .number()
      .optional()
      .default(2000)
      .describe(
        "Delay in milliseconds between multi-frame captures (default: 2000)"
      ),
  },
  async (params) => {
    try {
      const { captures, processId } = await runAndCapture({
        executablePath: params.executable_path,
        arguments: params.arguments,
        windowTitle: params.window_title,
        waitMs: params.wait_ms,
        savePath: params.save_path,
        closeAfter: params.close_after,
        captureCount: params.capture_count,
        captureIntervalMs: params.capture_interval_ms,
      });

      return buildCaptureResponse(captures, processId);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: capture_window ────────────────────────────────────────────

server.tool(
  "capture_window",
  "Capture a screenshot of an already-running window by process id, or by title as a fallback. " +
    "Returns the screenshot as an inline image and saves it to disk.",
  {
    process_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Process ID whose visible window should be captured. Prefer this when available from list_windows."
      ),
    window_title: z
      .string()
      .optional()
      .describe(
        "Optional title filter. Without process_id, this is used as a partial title match."
      ),
    save_path: z
      .string()
      .optional()
      .describe(
        "Directory or file path to save the screenshot. Defaults to .screenshots/ in the MCP server's install directory"
      ),
  },
  async (params) => {
    try {
      let result: CaptureResult;

      if (params.process_id !== undefined) {
        result = await captureWindowByProcessId(
          params.process_id,
          params.save_path,
          true,
          params.window_title
        );
      } else if (params.window_title) {
        result = await captureWindow(params.window_title, params.save_path);
      } else {
        throw new Error("Either process_id or window_title is required.");
      }

      return buildCaptureResponse([result], params.process_id);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: list_windows ──────────────────────────────────────────────

server.tool(
  "list_windows",
  "List all visible windows on the desktop with their titles and process information. " +
    "Use this to discover which windows are available for capture.",
  {},
  async () => {
    try {
      const windows = await listWindows();

      if (windows.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No visible windows found.",
            },
          ],
        };
      }

      const table = windows
        .map(
          (w) =>
            `• ${w.title}\n  Process: ${w.processName} (PID: ${w.processId})`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${windows.length} visible window(s):\n\n${table}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing windows: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Response Builder ────────────────────────────────────────────────

function buildCaptureResponse(
  captures: CaptureResult[],
  processId?: number
): {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
} {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [];

  const successCaptures = captures.filter((c) => c.success);
  const failedCaptures = captures.filter((c) => !c.success);

  // Add summary text
  const summaryParts: string[] = [];

  if (successCaptures.length > 0) {
    summaryParts.push(
      `✅ Captured ${successCaptures.length} screenshot(s):`
    );
    for (const cap of successCaptures) {
      summaryParts.push(
        `  • ${cap.path} (${cap.width}×${cap.height})`
      );
    }
  }

  if (failedCaptures.length > 0) {
    summaryParts.push(
      `❌ Failed ${failedCaptures.length} capture(s):`
    );
    for (const cap of failedCaptures) {
      summaryParts.push(`  • ${cap.error}`);
    }
  }

  if (processId !== undefined) {
    summaryParts.push(`\nProcess ID: ${processId}`);
  }

  content.push({
    type: "text" as const,
    text: summaryParts.join("\n"),
  });

  // Add the last successful screenshot as an inline image
  // (most clients display the last image best; for multi-frame, all paths are in text)
  const lastSuccess = successCaptures[successCaptures.length - 1];
  if (lastSuccess && lastSuccess.base64) {
    content.push({
      type: "image" as const,
      data: lastSuccess.base64,
      mimeType: "image/png",
    });
  }

  return {
    content,
    isError: successCaptures.length === 0 && failedCaptures.length > 0,
  };
}

// ─── Start ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
