// deno-lint-ignore-file no-import-prefix

import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { getOcvLogger, initLogger } from "./logger.ts";

Deno.test("getOcvLogger throws before initLogger is called", () => {
  assertEquals(
    typeof getOcvLogger,
    "function",
    "getOcvLogger should be an exported function",
  );

  // getOcvLogger() uses rootLogger which is null before init
  // It throws an Error with a specific message
  try {
    getOcvLogger();
    assertEquals(true, false, "Expected getOcvLogger() to throw");
  } catch (e) {
    assertEquals(
      e instanceof Error,
      true,
      "Expected an Error to be thrown",
    );
    assertEquals(
      (e as Error).message,
      "Logger not initialized. Call initLogger() first.",
    );
  }
});

Deno.test({
  name: "suppresses LogTape meta logger info message",
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "ocv-test-" });

    // Capture stdout by replacing Deno.stdout's writable stream.
    // LogTape's getConsoleSink() writes to Deno.stdout.writable.
    const captured: Uint8Array[] = [];
    const originalStdout = Deno.stdout;

    const capturingWritable = new WritableStream<Uint8Array>({
      write(chunk) {
        captured.push(chunk);
      },
    });

    Object.defineProperty(Deno, "stdout", {
      value: { writable: capturingWritable },
      configurable: true,
      writable: true,
    });

    try {
      await initLogger(tempDir);

      // Decode all captured chunks into a single string
      const output = captured.map((c) => new TextDecoder().decode(c)).join("");
      const lower = output.toLowerCase();

      assertEquals(
        lower.includes("meta"),
        false,
        "Expected no meta logger info message in stdout — category ['logtape', 'meta'] set to lowestLevel 'warning' with no sinks",
      );
    } finally {
      // Restore original stdout
      Object.defineProperty(Deno, "stdout", {
        value: originalStdout,
        configurable: true,
        writable: true,
      });

      // Clean up temp directory
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors — leaked temp dirs are acceptable in test failure
      }
    }
  },
});

Deno.test("getOcvLogger returns a Logger after initLogger", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "ocv-test-" });

  try {
    await initLogger(tempDir);
    const logger = getOcvLogger();

    // Logger should have the standard LogTape methods
    assertEquals(typeof logger, "object", "Logger should be an object");
    assertEquals(
      typeof logger.info,
      "function",
      "Logger.info should be a function",
    );
    assertEquals(
      typeof logger.warn,
      "function",
      "Logger.warn should be a function",
    );
    assertEquals(
      typeof logger.error,
      "function",
      "Logger.error should be a function",
    );
    assertEquals(
      typeof logger.debug,
      "function",
      "Logger.debug should be a function",
    );
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});
