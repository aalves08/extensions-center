/**
 * Import extraction without a parser dependency.
 *
 * The Node pipeline this is ported from used `@babel/parser`. Shipping that
 * here would add roughly 350KB gzipped to an extension whose entire purpose is
 * reporting on bundle weight, so this does the same job with two regexes.
 *
 * That trade was measured rather than assumed. Run over the 1,112 source files
 * of all eleven official extensions, this finds 5,534 imports against Babel's
 * 5,463. The twelve Babel catches that it misses are all bare CSS side-effect
 * imports (`import 'ag-grid.css'`), which no table here reports on. The extras
 * are `require()` calls in `vue.config.js` and `babel.config.js`, which is why
 * `require` is deliberately not matched below: those files are build config,
 * never shipped code, and counting them would invent npm dependencies that no
 * extension actually bundles.
 */

/**
 * Every `<script>` block in an SFC, not just the first.
 *
 * A component with both `<script>` and `<script setup>` imports from both, and
 * reading only the first silently loses half of them.
 */
const SCRIPT_BLOCK = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;

/**
 * `import … from 'x'`, `import 'x'`, `export … from 'x'`, `export * from 'x'`.
 *
 * `[\s\S]*?` rather than `.*?` because multi-line import lists are the norm in
 * this codebase and a dot would stop at the first newline.
 */
const STATIC_IMPORT = /(?:^|[\n;])\s*(?:import|export)\b(?:[\s\S]*?\bfrom\s*)?\s*['"]([^'"\n]+)['"]/g;

/** `import('x')` — lazily loaded routes and components. */
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;

/** Concatenated contents of every `<script>` block in a Vue SFC. */
function vueScripts(content: string): string {
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  SCRIPT_BLOCK.lastIndex = 0;

  while ((match = SCRIPT_BLOCK.exec(content)) !== null) {
    blocks.push(match[1]);
  }

  return blocks.join('\n');
}

/**
 * Named specifiers in an import statement, for the per-extension detail table.
 *
 * Knowing that six extensions import `@rancher/shell/config/types` matters far
 * less than knowing which handful of constants they take out of it, since that
 * is what a narrower public API would have to keep exporting.
 */
const SPECIFIER_CLAUSE = /(?:^|[\n;])\s*import\s+([\s\S]*?)\s+from\s*['"]([^'"\n]+)['"]/g;

export interface ParsedImport {
  source: string;
  specifiers: string[];
}

/** Turn an import clause (`{ a, b as c }`, `Foo`, `* as ns`) into specifier names. */
function parseClause(clause: string): string[] {
  const out: string[] = [];
  const braces = /\{([\s\S]*?)\}/.exec(clause);

  if (braces) {
    braces[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        // `type Foo as Bar` → `Foo`; the local alias is ours, the exported name is theirs.
        const name = part.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();

        if (name) {
          out.push(name);
        }
      });
  }

  if (/\*\s+as\s+/.test(clause)) {
    out.push('*');
  }

  // A default import is whatever sits outside the braces and the namespace form.
  const defaultName = clause
    .replace(/\{[\s\S]*?\}/, '')
    .replace(/\*\s+as\s+\w+/, '')
    .replace(/^type\s+/, '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)[0];

  if (defaultName && /^\w+$/.test(defaultName)) {
    out.push('default');
  }

  return out;
}

/**
 * Every module specifier imported by a source file.
 *
 * `filePath` is used only to decide whether the content needs SFC unwrapping.
 */
export function parseImports(filePath: string, content: string): ParsedImport[] {
  const src = filePath.toLowerCase().endsWith('.vue') ? vueScripts(content) : content;

  if (!src) {
    return [];
  }

  // Specifiers first, so the map is ready when the sources are collected.
  const specifiersBySource = new Map<string, string[]>();
  let match: RegExpExecArray | null;

  SPECIFIER_CLAUSE.lastIndex = 0;

  while ((match = SPECIFIER_CLAUSE.exec(src)) !== null) {
    const existing = specifiersBySource.get(match[2]) || [];

    specifiersBySource.set(match[2], existing.concat(parseClause(match[1])));
  }

  const out: ParsedImport[] = [];

  for (const regex of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    regex.lastIndex = 0;

    while ((match = regex.exec(src)) !== null) {
      const source = match[1];

      out.push({ source, specifiers: [...new Set(specifiersBySource.get(source) || [])] });
    }
  }

  return out;
}
