import {
  configure,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogger,
  type Logger,
} from "@logtape/logtape";
import { getRotatingFileSink } from "@logtape/file";
import { resolve } from "@std/path";

let configured = false;
let rootLogger: Logger | null = null;

function getLogDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  return resolve(home, ".local/share/ocv/logs");
}

export async function initLogger(logDir?: string): Promise<Logger> {
  if (configured && rootLogger) return rootLogger;

  const dir = logDir ?? getLogDir();
  await Deno.mkdir(dir, { recursive: true });

  await configure({
    sinks: {
      console: getConsoleSink(),
      file: getRotatingFileSink(resolve(dir, "ocv.log"), {
        maxSize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
        formatter: getJsonLinesFormatter(),
        bufferSize: 0, // flush every log record immediately
      }),
    },
    loggers: [
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: [] },
      { category: ["ocv"], lowestLevel: "info", sinks: ["console", "file"] },
      {
        category: ["ocv", "mcp"],
        lowestLevel: "info",
        sinks: ["console", "file"],
      },
    ],
  });

  configured = true;
  rootLogger = getLogger(["ocv"]);
  return rootLogger;
}

export function getOcvLogger(): Logger {
  if (!rootLogger) {
    throw new Error("Logger not initialized. Call initLogger() first.");
  }
  return rootLogger;
}
