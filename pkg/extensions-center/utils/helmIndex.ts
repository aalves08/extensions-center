/**
 * Version extraction for Helm repository index files.
 *
 * Two of these get read, and the difference between them is the whole point:
 * `index.yaml` in rancher/ui-plugin-charts is the official catalogue Rancher
 * actually serves, while the `index.yaml` on an extension's own `gh-pages`
 * branch is whatever that team last published. When they disagree, an upstream
 * release has not been packaged officially yet.
 *
 * Only chart names and version strings are wanted. A Helm index is machine
 * generated with a fixed two-space layout, so this reads the handful of lines
 * that matter rather than pulling a YAML parser in to walk a 140KB document:
 * chart names sit at indent 2 under `entries:`, and a chart version at indent 4.
 * Anything deeper belongs to a nested block such as `dependencies`, which has a
 * `version` of its own and must not be mistaken for the chart's.
 */

const ENTRIES = /^entries:\s*$/;
const CHART = /^ {2}([A-Za-z0-9._-]+):\s*$/;
const VERSION = /^ {4}version:\s*(\S+)\s*$/;

/** Chart name to every version the index lists for it, in file order. */
export function parseHelmIndexVersions(yaml: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};

  let inEntries = false;
  let chart: string | null = null;

  for (const line of (yaml || '').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }

    // Any other top-level key — `apiVersion`, `generated` — closes the block.
    if (!line.startsWith(' ')) {
      inEntries = ENTRIES.test(line);
      chart = null;

      continue;
    }

    if (!inEntries) {
      continue;
    }

    const name = CHART.exec(line);

    if (name) {
      chart = name[1];
      out[chart] = out[chart] || [];

      continue;
    }

    if (!chart) {
      continue;
    }

    // A list item carries its first key on the dash line (`  - annotations:`).
    // Lining that up with the rest means one indent rule instead of two.
    const version = VERSION.exec(line.replace(/^ {2}- /, '    '));

    if (version) {
      out[chart].push(version[1].replace(/^["']|["']$/g, ''));
    }
  }

  return out;
}
