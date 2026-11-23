/**
 * The ONE place a Kindfolks kit colour is read as a value rather than used
 * as a CSS variable.
 *
 * brand/BRAND.md rule 1: "Where CSS can't read a variable (a canvas chart,
 * an SVG attribute), read the value from tokens/tokens.json by name in one
 * helper file, never retype the hex." Most of this app can use a CSS
 * variable and should — `style={{ color: "var(--kf-text-muted)" }}` or the
 * Tailwind class. This helper exists for the places that genuinely cannot:
 * a canvas fill, a value handed to a library, a colour that has to be
 * interpolated.
 *
 * Never add a hex here either. If the kit lacks the colour, add an app role
 * to app/tokens.css and reference it as a variable.
 */
// NOTE: the kit README shows `import { tokens } from '.../tokens.json'`.
// Next's webpack treats that as a namespace import and then reports
// "'tokens'.'map' is not exported from ... tokens.json" — it tries to
// resolve the array methods as named exports of the JSON module. Importing
// the module's default and reading `.tokens` off it is the same data and
// compiles clean. Worth feeding back to the kit.
import tokensJson from "@/brand/tokens/tokens.json";

const tokens = tokensJson.tokens;

const BY_NAME = new Map(tokens.map((t) => [t.name, t.value]));

/**
 * The value of a kit token, by its full `--kf-*` name. Throws rather than
 * falling back: a typo that silently resolved to black would be a colour
 * bug nobody could see in a diff.
 */
export function kfValue(name: string): string {
  const v = BY_NAME.get(name);
  if (!v) throw new Error(`Unknown Kindfolks token: ${name}`);
  return v;
}
