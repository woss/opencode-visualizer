import { join } from "@std/path/join";

const OCVIGNORE_PATH = join(
  Deno.env.get("HOME") || "~",
  ".config",
  "ocv",
  ".ocvignore",
);

export interface IgnoreRules {
  includes: RegExp[];
  excludes: RegExp[];
}

/** Load .ocvignore from ~/.config/ocv/.ocvignore. Returns empty rules if file not found. */
export function loadOcvignore(): IgnoreRules {
  const excludes: RegExp[] = [];
  const includes: RegExp[] = [];
  try {
    const content = Deno.readTextFileSync(OCVIGNORE_PATH);
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("!")) {
        includes.push(gitignoreToRegex(line.slice(1)));
      } else {
        excludes.push(gitignoreToRegex(line));
      }
    }
  } catch {
    // File doesn't exist — not an error
  }
  return { includes, excludes };
}

/** Check if a name matches any exclude rule (with ! negation support). */
export function isIgnoredByName(name: string, rules: IgnoreRules): boolean {
  const excluded = rules.excludes.some((re) => re.test(name));
  if (!excluded) return false;
  // Negation patterns can re-include
  return !rules.includes.some((re) => re.test(name));
}

/**
 * Convert a gitignore-style pattern to a RegExp.
 * Supports: * (any chars except /), ** (any chars including /), ? (single char).
 * Matching is anchored (^...$).
 */
function gitignoreToRegex(pattern: string): RegExp {
  let src = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && i + 1 < pattern.length && pattern[i + 1] === "*") {
      src += ".*";
      i++;
      if (i + 1 < pattern.length && pattern[i + 1] === "/") i++;
    } else if (ch === "*") {
      src += "[^/]*";
    } else if (ch === "?") {
      src += "[^/]";
    } else if ("\\^$+{}()|[].".includes(ch)) {
      src += "\\" + ch;
    } else {
      src += ch;
    }
  }
  src += "$";
  return new RegExp(src);
}
