/**
 * A simple inline spinner that writes to stderr.
 * Call `.stop()` to clear the spinner line.
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export interface Spinner {
  stop(): void;
}

export function showSpinner(msg: string): Spinner {
  let stopped = false;
  let i = 0;
  const isTTY = Deno.stderr.isTerminal();

  if (!isTTY) {
    console.error(msg);
    return { stop: () => {} };
  }

  const timer = setInterval(() => {
    if (stopped) return;
    const frame = FRAMES[i % FRAMES.length];
    Deno.stderr.writeSync(new TextEncoder().encode(`\r${frame} ${msg}`));
    i++;
  }, INTERVAL_MS);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      Deno.stderr.writeSync(new TextEncoder().encode("\r\x1b[K"));
    },
  };
}
