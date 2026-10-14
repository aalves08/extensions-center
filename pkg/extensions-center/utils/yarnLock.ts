/**
 * Resolved dependency versions, read out of a repo's `yarn.lock`.
 *
 * Bundle analysis can name every npm package inside a shipped bundle but not
 * its version: a source map records `node_modules/lodash/index.js`, and nothing
 * in that path says which lodash. Without a version, joining a bundle against a
 * vulnerability feed can only match on the package name, which flags every
 * bundle containing any lodash whether or not it carries the vulnerable one.
 *
 * The lockfile at the extension's release tag is the one place the resolved
 * versions are written down, so that is where they come from.
 *
 * One name can legitimately resolve to several versions — that is exactly what
 * nested `node_modules` are — so this returns every version it finds rather
 * than picking one. Callers decide what to do with the ambiguity; see
 * `matchAdvisory` in `vulnReach.ts`, which reports it rather than hiding it.
 */

/**
 * A header line opening a lockfile entry.
 *
 * Classic (v1) and Berry (v2+) differ in the body but agree here: one or more
 * comma-separated specifiers at column zero, terminated by a colon. Quotes are
 * optional in v1 and mandatory in Berry whenever the specifier contains a
 * comma or colon, so both spellings have to be accepted.
 */
const HEADER = /^(?! |\t|#)(.+):\s*$/;

/**
 * `  version "1.2.3"` (v1) or `  version: 1.2.3` (Berry).
 *
 * Indented, so it can never be confused with a header.
 */
const VERSION = /^[ \t]+version:?\s+"?([^"\s]+)"?\s*$/;

/**
 * Package name out of one lockfile specifier.
 *
 * `lodash@^4.17.0` → `lodash`, `@scope/pkg@npm:^1.0.0` → `@scope/pkg`. The
 * separator is the *last* `@`, because a scoped name opens with one; and
 * Berry's `npm:` protocol sits on the range side of it, so stripping the range
 * removes it too.
 */
export function specifierName(spec: string): string | null {
  const cleaned = spec.trim().replace(/^"|"$/g, '');
  const at = cleaned.lastIndexOf('@');

  // `at === 0` is a scoped name with no range at all, which is not a specifier.
  if (at <= 0) {
    return null;
  }

  return cleaned.slice(0, at) || null;
}

/**
 * Every resolved version per package name.
 *
 * Deliberately tolerant: an entry whose header parses but whose body has no
 * `version` is skipped rather than throwing. A lockfile is 20,000 lines of
 * machine-written text and one unrecognised stanza should cost that stanza, not
 * the extension's whole row.
 */
export function parseYarnLock(text: string): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const lines = text.split('\n');

  let pending: string[] = [];

  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) {
      continue;
    }

    const header = HEADER.exec(line);

    if (header) {
      // Berry writes a `__metadata:` block with the same shape as an entry.
      pending = header[1] === '__metadata' ? [] : header[1].split(',')
        .map(specifierName)
        .filter((n): n is string => !!n);

      continue;
    }

    if (!pending.length) {
      continue;
    }

    const version = VERSION.exec(line);

    if (version) {
      for (const name of pending) {
        const versions = out.get(name) || new Set<string>();

        versions.add(version[1]);
        out.set(name, versions);
      }

      // The version is the only field wanted, so stop attributing to this
      // header the moment it is found. Anything after it belongs to the same
      // entry and cannot change the answer.
      pending = [];
    }
  }

  return new Map([...out.entries()].map(([name, versions]) => [name, [...versions].sort()]));
}
