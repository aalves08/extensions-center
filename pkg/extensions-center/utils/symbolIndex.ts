import { ExtensionImportDetail, ExtensionImportPath, ImportAnalysisDoc } from '../types/analysis';
import {
  ApiArea, ApiRisk, pathArea, pathRisk, relShellPath, RISK_ORDER
} from './apiSurface';

/**
 * Who imports a given shell symbol — the API surface read backwards.
 *
 * `buildApiSurface` answers "which symbols come out of this path". This answers
 * the question anyone proposing a change to shell actually has: name a symbol,
 * get the extensions that would have to be touched. Same stored specifiers,
 * inverted.
 *
 * Pure over the saved document. No fetch and no rebuild — the specifiers have
 * been persisted since the first version of the import analysis.
 *
 * Four things it cannot say. Each is surfaced rather than papered over, because
 * a list of names reads as complete whether or not it is:
 *
 *  - **Imports, not calls.** An extension that imports a symbol and never uses
 *    it is still listed. That over-reports and never under-reports, which is
 *    the safe direction for "what breaks" — but it is not a usage count.
 *  - **Counts are per path.** The analysis stores one count per path with a
 *    deduplicated set of names beside it, so `imports` here is import
 *    statements against the path the symbol came from, not against the symbol.
 *  - **A namespace import names nothing.** `import * as ns from '@shell/x'`
 *    records `*`, so that extension cannot be cleared for any symbol in the
 *    module. Those extensions ride along on every row of the path as
 *    `unclearExts`, and paths that *only* have namespace importers get their
 *    own list — there is no row to hang them on, and dropping them silently
 *    would be the one failure mode that matters here.
 *  - **Some forms record no specifier at all.** Dynamic `import()` and
 *    `export … from` are counted as paths but produce no names. They have the
 *    same consequence as the namespace case and are treated the same way —
 *    `unclearExts` where the path has rows, the `unrecorded` list where it has
 *    none — because "no symbols were recorded" and "no symbols are used" are
 *    different facts and only one of them is evidence.
 */

/** Named export, or the module's default. `*` is tracked separately. */
export type SymbolKind = 'named' | 'default';

/** Which package the symbol belongs to. Risk rules only exist for shell. */
export type SymbolScope = 'shell' | 'components';

/** One symbol, taken from one path, across every extension that names it. */
export interface SymbolRow {
  /** Scope, path and symbol: the same name from two modules is two things */
  key: string;
  symbol: string;
  kind: SymbolKind;
  path: string;
  /** Path as the tables show it — prefix stripped for shell */
  rel: string;
  scope: SymbolScope;
  /** Null for components: `pathRisk` is written about shell's own tree */
  area: ApiArea | null;
  risk: ApiRisk | null;
  /** Extensions whose source names this symbol */
  exts: string[];
  /** Import statements against this path, summed over `exts`. See the header. */
  imports: number;
  /**
   * Extensions that import this path without naming anything.
   *
   * A whole-module import, a dynamic `import()` or a re-export — three forms,
   * one consequence: nothing records which exports they touch. Not in `exts`,
   * because nothing says they touch this symbol, and not dropped either,
   * because nothing says they don't. They are what makes a row's extension
   * list a lower bound rather than an answer.
   */
  unclearExts: string[];
}

/** A path with no symbol-level answer, for the two lists that need one. */
export interface SymbolBlindPath {
  path: string;
  rel: string;
  scope: SymbolScope;
  area: ApiArea | null;
  risk: ApiRisk | null;
  exts: string[];
  imports: number;
}

export interface SymbolIndex {
  rows: SymbolRow[];
  /** Paths imported only as a whole module, so no row could be built */
  namespaceOnly: SymbolBlindPath[];
  /** Paths whose import form records no names — dynamic imports, re-exports */
  unrecorded: SymbolBlindPath[];
  totals: {
    /** Distinct symbol names, regardless of how many paths export them */
    symbols: number;
    /** Rows, i.e. distinct symbol-and-path pairs */
    rows: number;
    /** Distinct paths with at least one row */
    paths: number;
    extensions: number;
    namespaceOnly: number;
    unrecorded: number;
  };
}

export function emptySymbolIndex(): SymbolIndex {
  return {
    rows:          [],
    namespaceOnly: [],
    unrecorded:    [],
    totals:        {
      symbols: 0, rows: 0, paths: 0, extensions: 0, namespaceOnly: 0, unrecorded: 0
    },
  };
}

/** Accumulators keep a Set for dedupe; the public shape carries sorted arrays. */
interface RowAcc extends Omit<SymbolRow, 'exts' | 'unclearExts'> {
  extSet: Set<string>;
}

interface BlindAcc extends Omit<SymbolBlindPath, 'exts'> {
  extSet: Set<string>;
}

const SCOPES: { scope: SymbolScope; pick: (d: ExtensionImportDetail) => ExtensionImportPath[] }[] = [
  { scope: 'shell', pick: (d) => d.shell || [] },
  { scope: 'components', pick: (d) => d.components || [] },
];

function blind(map: Map<string, BlindAcc>, seed: Omit<SymbolBlindPath, 'exts' | 'imports'>, ext: string, imports: number): void {
  const key = `${ seed.scope }|${ seed.path }`;
  const entry = map.get(key) || {
    ...seed, imports: 0, extSet: new Set<string>()
  };

  entry.imports += imports;
  entry.extSet.add(ext);
  map.set(key, entry);
}

const finishBlind = (map: Map<string, BlindAcc>): SymbolBlindPath[] => [...map.values()]
  .map(({ extSet, ...rest }) => ({ ...rest, exts: [...extSet].sort() }))
  .sort((a, b) => b.exts.length - a.exts.length || b.imports - a.imports || a.rel.localeCompare(b.rel));

export function buildSymbolIndex(doc: ImportAnalysisDoc | null): SymbolIndex {
  if (!doc) {
    return emptySymbolIndex();
  }

  const rows = new Map<string, RowAcc>();
  /**
   * Extensions that reached a path without naming anything in it.
   *
   * Fed by both blind forms, not just the namespace one. A path that ten
   * extensions import by name and an eleventh reaches through `import()` must
   * not render as a list of ten — the eleventh is the one that would be
   * forgotten, and the whole point of the view is that the list is complete.
   */
  const unclearByPath = new Map<string, Set<string>>();
  const namespacePaths = new Map<string, BlindAcc>();
  const unrecorded = new Map<string, BlindAcc>();
  const extensions = new Set<string>();

  const unclear = (path: string, ext: string) => {
    const set = unclearByPath.get(path) || new Set<string>();

    set.add(ext);
    unclearByPath.set(path, set);
  };

  for (const [ext, detail] of Object.entries(doc.detail || {})) {
    extensions.add(ext);

    for (const { scope, pick } of SCOPES) {
      for (const entry of pick(detail)) {
        const specs = entry.specifiers || [];
        const rel = scope === 'shell' ? relShellPath(entry.path) : entry.path;
        const area = scope === 'shell' ? pathArea(rel) : null;
        const risk = scope === 'shell' ? pathRisk(rel) : null;
        const seed = {
          path: entry.path, rel, scope, area, risk
        };

        // No specifiers at all is a property of the import *form*, not of the
        // module. Listed apart from the namespace case below because one is a
        // limitation of the scanner and the other is a real finding — but both
        // feed `unclearByPath`, because they have the same consequence.
        if (!specs.length) {
          blind(unrecorded, seed, ext, entry.count);
          unclear(entry.path, ext);
          continue;
        }

        if (specs.includes('*')) {
          unclear(entry.path, ext);

          if (specs.length === 1) {
            blind(namespacePaths, seed, ext, entry.count);
          }
        }

        for (const spec of specs) {
          if (spec === '*') {
            continue;
          }

          const symbol = spec === 'default' ? 'default' : spec;
          const key = `${ scope }|${ entry.path }|${ symbol }`;
          const row = rows.get(key) || {
            key,
            symbol,
            kind:    (spec === 'default' ? 'default' : 'named') as SymbolKind,
            ...seed,
            imports: 0,
            extSet:  new Set<string>(),
          };

          row.imports += entry.count;
          row.extSet.add(ext);
          rows.set(key, row);
        }
      }
    }
  }

  const finished: SymbolRow[] = [...rows.values()].map(({ extSet, ...rest }) => {
    const exts = [...extSet].sort();

    return {
      ...rest,
      exts,
      // Minus the ones already named: an extension can reach a path blindly in
      // one file and name symbols from it in another, and listing it in both
      // columns would read as two different extensions.
      unclearExts: [...(unclearByPath.get(rest.path) || [])].filter((e) => !extSet.has(e)).sort(),
    };
  });

  // Reach first, then volume, and reach counts the unclear ones. A symbol six
  // extensions import is a harder change than one imported two hundred times
  // by a single extension, and an extension that might use it is work too.
  finished.sort((a, b) => b.exts.length + b.unclearExts.length - (a.exts.length + a.unclearExts.length) ||
    b.imports - a.imports ||
    a.symbol.localeCompare(b.symbol) ||
    a.rel.localeCompare(b.rel));

  // A path only counts as blind if no extension ever named anything from it.
  // One that did has rows, and those rows — carrying the blind extensions in
  // `unclearExts` — are a better answer than a warning in a separate table.
  const named = new Set(finished.map((r) => r.path));
  const namespaceOnly = finishBlind(namespacePaths).filter((p) => !named.has(p.path));
  const unnamed = finishBlind(unrecorded).filter((p) => !named.has(p.path));

  return {
    rows:       finished,
    namespaceOnly,
    unrecorded: unnamed,
    totals:     {
      symbols:       new Set(finished.map((r) => r.symbol)).size,
      rows:          finished.length,
      paths:         named.size,
      extensions:    extensions.size,
      namespaceOnly: namespaceOnly.length,
      unrecorded:    unnamed.length,
    },
  };
}

/** Sort rank for the risk column, so `null` (components) sorts last. */
export function riskRank(risk: ApiRisk | null): number {
  return risk ? RISK_ORDER.indexOf(risk) : RISK_ORDER.length;
}

/**
 * Rows whose symbol or path contains `query`, case-insensitively.
 *
 * Matching the path as well as the symbol is deliberate: "show me everything
 * out of `utils/string`" is the same investigation as "show me `escapeHtml`",
 * and making the user guess which box they are in helps nobody.
 */
export function filterSymbols(rows: SymbolRow[], query: string): SymbolRow[] {
  const q = query.trim().toLowerCase();

  if (!q) {
    return rows;
  }

  return rows.filter((r) => r.symbol.toLowerCase().includes(q) || r.rel.toLowerCase().includes(q));
}
