import { ImportAnalysisDoc } from '../types/analysis';

/**
 * The extension-facing API surface of `@rancher/shell`, derived from what the
 * extensions actually import.
 *
 * Shell marks nothing as public or private, so every path any extension reaches
 * for is, in practice, API that has to hold still. The import analysis already
 * records all of it — this groups it two ways the raw path list cannot: by what
 * the path is *for*, and by how likely it is to break on a shell upgrade.
 *
 * The second grouping is the point. A path under `pages/` or `edit/` is shell's
 * own screens being imported by somebody else's extension; nothing guarantees
 * it exists next release, and nothing will warn anyone when it stops. Those are
 * the rows worth triaging first, and the list is short enough to triage.
 *
 * Pure over the saved document. Nothing here fetches, and nothing needs a
 * rebuild to appear — the specifiers it reads have been persisted all along.
 */

/** How exposed an import is to shell changing underneath it. Worst first. */
export type ApiRisk = 'private' | 'internal' | 'file-suffix' | 'ok';

export const RISK_ORDER: ApiRisk[] = ['private', 'internal', 'file-suffix', 'ok'];

/**
 * Coarse grouping for a shell path.
 *
 * Closer to "what is this for" than to the folder layout, because the question
 * being asked of the list is about roles — which of these would a supported API
 * keep, which would it wrap, which would it drop.
 */
export type ApiArea =
  | 'form-components'
  | 'formatters'
  | 'components'
  | 'rancher-components'
  | 'utils'
  | 'config'
  | 'models'
  | 'store'
  | 'composables'
  | 'mixins'
  | 'types'
  | 'resource-views'
  | 'pages'
  | 'assets'
  | 'build-internals'
  | 'other';

/** Directories that are shell's own resource screens, not a library. */
const VIEW_DIRS = ['edit', 'detail', 'list', 'create', 'promptRemove', 'dialog'];

export function pathArea(rel: string): ApiArea {
  const dir = rel.split('/')[0];

  if (dir === 'components') {
    if (rel.startsWith('components/form/')) {
      return 'form-components';
    }

    if (rel.startsWith('components/formatter/')) {
      return 'formatters';
    }

    return 'components';
  }

  if (dir === 'rancher-components' || rel.startsWith('@components')) {
    return 'rancher-components';
  }

  if (VIEW_DIRS.includes(dir)) {
    return 'resource-views';
  }

  switch (dir) {
  case 'utils': return 'utils';
  case 'config': return 'config';
  case 'models': return 'models';
  case 'store': case 'plugins': return 'store';
  case 'composables': return 'composables';
  case 'mixins': return 'mixins';
  case 'types': case 'core': return 'types';
  case 'pages': return 'pages';
  case 'assets': return 'assets';
  case 'initialize': case 'pkg': return 'build-internals';
  default: return 'other';
  }
}

/**
 * How badly a path is likely to break.
 *
 * `file-suffix` is the mild one and still worth listing: importing
 * `@shell/utils/foo.js` rather than `@shell/utils/foo` pins the file extension,
 * so a `.js` → `.ts` conversion inside shell — which is a non-event for every
 * other consumer — breaks that extension's build.
 */
export function pathRisk(rel: string): ApiRisk {
  if (rel.startsWith('pages/') || rel.startsWith('initialize/')) {
    return 'private';
  }

  if (new RegExp(`^(${ VIEW_DIRS.join('|') })/`).test(rel)) {
    return 'private';
  }

  if (rel.startsWith('components/Resource/')) {
    return 'private';
  }

  if (rel.startsWith('store/') || rel.startsWith('plugins/') || rel.startsWith('mixins/') || rel.startsWith('models/')) {
    return 'internal';
  }

  if (/\.(vue|js|ts)$/.test(rel)) {
    return 'file-suffix';
  }

  return 'ok';
}

/** One shell import path, as the whole estate uses it. */
export interface ApiSurfacePath {
  /** Full import path, e.g. `@rancher/shell/utils/string` */
  path: string;
  /** Same path with the package prefix stripped — what the tables show */
  rel: string;
  area: ApiArea;
  risk: ApiRisk;
  /** Import statements across every extension */
  total: number;
  exts: string[];
  /** Source bytes of the resolved file in rancher/dashboard, null if unresolved */
  bytes: number | null;
  /** Every named export taken from this path, unioned across extensions */
  specifiers: string[];
}

export interface ApiRiskTotal {
  risk: ApiRisk;
  paths: number;
  imports: number;
  /** Extensions with at least one path at this risk level */
  exts: number;
}

export interface ApiAreaTotal {
  area: ApiArea;
  paths: number;
  imports: number;
  exts: number;
}

/** One extension's exposure, for the per-extension ranking. */
export interface ApiExtensionRisk {
  name: string;
  paths: number;
  imports: number;
  /** Distinct named exports it relies on */
  specifiers: number;
  /** Paths at any risk level other than `ok` */
  risky: number;
}

export interface ApiSurface {
  paths: ApiSurfacePath[];
  byRisk: ApiRiskTotal[];
  byArea: ApiAreaTotal[];
  byExtension: ApiExtensionRisk[];
  totals: {
    extensions: number;
    shellPaths: number;
    shellImports: number;
    /** Distinct symbols across the whole surface — the real width of the API */
    distinctSpecifiers: number;
    riskyPaths: number;
  };
}

export function emptySurface(): ApiSurface {
  return {
    paths:       [],
    byRisk:      [],
    byArea:      [],
    byExtension: [],
    totals:      {
      extensions: 0, shellPaths: 0, shellImports: 0, distinctSpecifiers: 0, riskyPaths: 0
    },
  };
}

const stripPrefix = (path: string) => path.replace(/^@rancher\/shell\//, '').replace(/^@shell\//, '');

export function buildApiSurface(doc: ImportAnalysisDoc | null): ApiSurface {
  if (!doc) {
    return emptySurface();
  }

  // Specifiers are recorded per extension, not per path, so the union has to be
  // rebuilt here. It is what makes the table answer "what would break if this
  // path changed" rather than only "how often is it imported".
  const specsByPath = new Map<string, Set<string>>();

  for (const detail of Object.values(doc.detail || {})) {
    for (const entry of detail.shell || []) {
      const set = specsByPath.get(entry.path) || new Set<string>();

      for (const spec of entry.specifiers || []) {
        set.add(spec);
      }

      specsByPath.set(entry.path, set);
    }
  }

  const paths: ApiSurfacePath[] = (doc.shellPaths || []).map((p) => {
    const rel = stripPrefix(p.path);

    return {
      path:       p.path,
      rel,
      area:       pathArea(rel),
      risk:       pathRisk(rel),
      total:      p.total,
      exts:       p.exts,
      bytes:      p.bytes,
      specifiers: [...(specsByPath.get(p.path) || [])].sort(),
    };
  });

  // Risk first, then volume: a private path one extension imports once still
  // outranks a safe one imported two hundred times, because only one of them
  // is going to break.
  paths.sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) ||
    b.total - a.total ||
    a.rel.localeCompare(b.rel));

  const riskMap = new Map<ApiRisk, ApiRiskTotal & { extSet: Set<string> }>();
  const areaMap = new Map<ApiArea, ApiAreaTotal & { extSet: Set<string> }>();

  for (const p of paths) {
    const risk = riskMap.get(p.risk) || {
      risk: p.risk, paths: 0, imports: 0, exts: 0, extSet: new Set<string>()
    };

    risk.paths++;
    risk.imports += p.total;
    p.exts.forEach((e) => risk.extSet.add(e));
    riskMap.set(p.risk, risk);

    const area = areaMap.get(p.area) || {
      area: p.area, paths: 0, imports: 0, exts: 0, extSet: new Set<string>()
    };

    area.paths++;
    area.imports += p.total;
    p.exts.forEach((e) => area.extSet.add(e));
    areaMap.set(p.area, area);
  }

  const byRisk = [...riskMap.values()]
    .map(({ extSet, ...rest }) => ({ ...rest, exts: extSet.size }))
    .sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk));

  const byArea = [...areaMap.values()]
    .map(({ extSet, ...rest }) => ({ ...rest, exts: extSet.size }))
    .sort((a, b) => b.imports - a.imports);

  const byExtension: ApiExtensionRisk[] = Object.entries(doc.detail || {}).map(([name, detail]) => {
    const shell = detail.shell || [];
    const specs = new Set<string>();

    for (const entry of shell) {
      (entry.specifiers || []).forEach((s) => specs.add(s));
    }

    return {
      name,
      paths:      shell.length,
      imports:    shell.reduce((sum, s) => sum + s.count, 0),
      specifiers: specs.size,
      risky:      shell.filter((s) => pathRisk(stripPrefix(s.path)) !== 'ok').length,
    };
  }).sort((a, b) => b.risky - a.risky || b.paths - a.paths || a.name.localeCompare(b.name));

  const allSpecs = new Set<string>();

  for (const set of specsByPath.values()) {
    set.forEach((s) => allSpecs.add(s));
  }

  return {
    paths,
    byRisk,
    byArea,
    byExtension,
    totals: {
      extensions:         byExtension.length,
      shellPaths:         paths.length,
      shellImports:       paths.reduce((sum, p) => sum + p.total, 0),
      distinctSpecifiers: allSpecs.size,
      riskyPaths:         paths.filter((p) => p.risk !== 'ok').length,
    },
  };
}
