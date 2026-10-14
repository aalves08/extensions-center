import { compareSemver } from './version';

/**
 * Evaluating the vulnerable-version ranges that advisories carry.
 *
 * GitHub writes these as comma-separated comparators meaning AND — `>= 4.0.0,
 * < 4.17.19` — and OSV records converted by `usePublicVulns` keep the same
 * shape. That is the whole grammar in use here: no `||`, no `^`, no `~`, no
 * `x` wildcards, because no advisory feed emits them in this field.
 *
 * Deliberately three-valued. A range this cannot parse returns `null` rather
 * than `false`, so a caller can say "name matched, version undetermined"
 * instead of quietly dropping a real finding — the failure mode that matters
 * when the output is a security claim.
 */

/** `>= 4.0.0`, `< 1.2.3`, `= 1.0.0`, or a bare version meaning equality. */
const CLAUSE = /^(>=|<=|==|=|>|<)?\s*v?(\d[^\s,]*)$/;

/**
 * Whether `version` falls inside `range`.
 *
 * `null` means undetermined: either there is no range to check against, or one
 * of its clauses is in a form this does not recognise. One unparseable clause
 * poisons the whole answer rather than being skipped, since dropping a clause
 * from an AND can only ever widen the range and turn a miss into a false hit.
 */
export function satisfiesRange(version: string, range: string | null | undefined): boolean | null {
  if (!range) {
    return null;
  }

  const clauses = range.split(',').map((c) => c.trim()).filter(Boolean);

  if (!clauses.length) {
    return null;
  }

  for (const clause of clauses) {
    const parsed = CLAUSE.exec(clause);

    if (!parsed) {
      return null;
    }

    const op = parsed[1] || '=';
    const cmp = compareSemver(version, parsed[2]);

    const ok = {
      '>=': cmp >= 0,
      '<=': cmp <= 0,
      '>':  cmp > 0,
      '<':  cmp < 0,
      '=':  cmp === 0,
      '==': cmp === 0,
    }[op];

    if (!ok) {
      return false;
    }
  }

  return true;
}

/** How confidently a set of resolved versions was matched against a range. */
export type RangeVerdict = 'hit' | 'miss' | 'partial' | 'unknown';

/**
 * Check every version a package resolved to against one advisory's range.
 *
 * `partial` is the case worth naming: a lockfile that resolves `lodash` twice,
 * once vulnerable and once not, is a real and common state, and reporting it
 * as a plain hit would overstate while reporting it as a miss would hide a
 * genuine exposure.
 */
export function matchVersions(versions: string[], range: string | null | undefined): RangeVerdict {
  if (!versions.length) {
    return 'unknown';
  }

  const results = versions.map((v) => satisfiesRange(v, range));

  if (results.some((r) => r === null)) {
    return 'unknown';
  }

  const hits = results.filter(Boolean).length;

  if (!hits) {
    return 'miss';
  }

  return hits === results.length ? 'hit' : 'partial';
}
