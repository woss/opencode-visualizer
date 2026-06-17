// Color/style constants
export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const BLUE = "\x1b[34m";
export const MAGENTA = "\x1b[35m";
export const CYAN = "\x1b[36m";
export const WHITE = "\x1b[37m";
export const BG_BLUE = "\x1b[44m";
export const BG_GREEN = "\x1b[42m";

// Box-drawing chars
export const TL = "\u250C"; // top-left
export const TR = "\u2510"; // top-right
export const BL = "\u2514"; // bottom-left
export const BR = "\u2518"; // bottom-right
export const H = "\u2500"; // horizontal
export const V = "\u2502"; // vertical
export const TM = "\u252C"; // T-down (top middle)
export const BM = "\u2534"; // T-up (bottom middle)
export const LM = "\u251C"; // T-right (left middle)
export const RM = "\u2524"; // T-left (right middle)
export const CM = "\u253C"; // cross

// Generate a horizontal bar: "████████░░░░" proportional to value/max
export function bar(value: number, max: number, width: number): string {
  if (max <= 0) return "\u2591".repeat(width);
  const filled = Math.round((value / max) * width);
  return "\u2588".repeat(Math.max(0, Math.min(width, filled))) +
    "\u2591".repeat(Math.max(0, width - Math.min(width, filled)));
}

// Generate sparkline from ordered values using Unicode block heights
export function sparkline(values: number[]): string {
  const chars = [
    "\u2581",
    "\u2582",
    "\u2583",
    "\u2584",
    "\u2585",
    "\u2586",
    "\u2587",
    "\u2588",
  ];
  const max = Math.max(...values, 1);
  return values.map((v) => chars[Math.min(7, Math.round((v / max) * 7))]).join(
    "",
  );
}

// Strip ANSI escape codes from a string
export function stripAnsi(text: string): string {
  const esc = String.fromCharCode(27);
  return text.replace(new RegExp(esc + "\\[[0-9;]*m", "g"), "");
}

// Pad or truncate string to exact width (ANSI-aware)
export function pad(text: string, width: number): string {
  const plain = stripAnsi(text);
  const len = plain.length;
  if (len >= width) return plain.slice(0, width);
  return text + " ".repeat(width - len);
}

export const UNDERLINE = "\x1b[4m";

/** Colored horizontal bar: filled blocks in color, empty blocks in dim */
export function barColored(
  value: number,
  max: number,
  width: number,
  color: string,
): string {
  if (max <= 0 || width <= 0) return "";
  const filled = Math.round((value / max) * width);
  const fill = Math.max(0, Math.min(width, filled));
  const empty = width - fill;
  return color + "\u2588".repeat(fill) + RESET + DIM + "\u2591".repeat(empty) +
    RESET;
}

/** Auto-colored bar: green >66%, yellow 33-66%, red <33% */
export function barGradient(value: number, max: number, width: number): string {
  const pct = max > 0 ? value / max : 0;
  const color = pct > 0.66 ? GREEN : pct > 0.33 ? YELLOW : RED;
  return barColored(value, max, width, color);
}

/** Dual-colored bar: main in mainColor, sub in subColor, rest dim */
export function barDualColored(
  mainVal: number,
  subVal: number,
  maxVal: number,
  width: number,
  mainColor: string,
  subColor: string,
): string {
  if (maxVal <= 0 || width <= 0) return "";
  const mainW = Math.max(
    0,
    Math.min(width, Math.round((mainVal / maxVal) * width)),
  );
  const subW = Math.max(
    0,
    Math.min(width - mainW, Math.round((subVal / maxVal) * width)),
  );
  const emptyW = width - mainW - subW;
  return mainColor + "\u2588".repeat(mainW) + subColor + "\u2588".repeat(subW) +
    DIM + "\u2591".repeat(emptyW) + RESET;
}

// Format large numbers with commas
export function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format bytes as IEC binary units (KiB, MiB, GiB). */
export function fmtBinaryBytes(n: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let size = n;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${i === 0 ? size : size.toFixed(1)} ${units[i]}`;
}
