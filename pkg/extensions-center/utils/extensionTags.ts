/**
 * Working out which release tag belongs to which extension.
 *
 * Most official repos hold exactly one extension, so "the newest release" and
 * "the newest release of this extension" are the same tag and none of this
 * matters. `neuvector/security-ui-exts` holds four `pkg/` directories and cuts
 * releases for several of them into one interleaved stream:
 *
 *   vulnerability-scanner-0.9.2
 *   runtime-enforcer-0.1.1
 *   vulnerability-scanner-0.9.1
 *   runtime-enforcer-0.1.0
 *
 * Taking the first entry hands vulnerability-scanner whichever sibling
 * happened to release most recently. The version that produces exists nowhere
 * on gh-pages, which is why that row read "Not published" against a version
 * called `runtime-enforcer-0.1.0` — and why it would silently change every
 * time either extension cut a release.
 */

/**
 * A tag that names a version and nothing else: `1.2.3`, `v1.9.0`,
 * `v1.10.0-dev-20261011`.
 */
const BARE_VERSION = /^v?\d+(\.\d+)*(?:[-+.].*)?$/;

/**
 * Bare semver out of a release tag.
 *
 * Extension repos tag three different ways: `v1.9.0`, `kubewarden-4.2.1` and
 * `observability@2.4.0`. The name prefix has to go before the `v` does, and the
 * `v` is only stripped when a digit follows it — the Node script this is ported
 * from used a plain `/^v/`, which is why its published report contains
 * `irtual-clusters-1.2.0` and `ulnerability-scanner-0.9.0`.
 */
export function semverFromTag(extName: string, tag: string): string {
  const escaped = extName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return tag
    .replace(new RegExp(`^${ escaped }[-@]`, 'i'), '')
    .replace(/^v(?=\d)/, '');
}

/**
 * How strongly a tag claims to be a release of `extName`.
 *
 * - `named` — the tag carries the extension's name (`kubewarden-4.2.2`,
 *   `observability@2.4.2`). Unambiguous.
 * - `bare` — the tag names a version and no extension (`v1.9.0`). Reads as
 *   "this repo's release", which is right for a repo holding one extension and
 *   genuinely undecidable for a repo holding several.
 * - `other` — the tag names something else (`stackstate-0.7.0`,
 *   `runtime-enforcer-0.1.1`). Never this extension's.
 */
export type TagMatch = 'named' | 'bare' | 'other';

export function matchTag(extName: string, tag: string): TagMatch {
  if (semverFromTag(extName, tag) !== tag) {
    return 'named';
  }

  return BARE_VERSION.test(tag) ? 'bare' : 'other';
}

/**
 * Whether a tag can be read as a release of `extName`.
 *
 * `siblings` is the number of other extensions published out of the same repo.
 * With none, a bare version tag is accepted; with any, it is refused, because
 * there is nothing in `v1.2.0` to say which of them it belongs to and guessing
 * is how the wrong version got onto the page in the first place.
 */
export function tagBelongsTo(extName: string, tag: string, siblings: number): boolean {
  const match = matchTag(extName, tag);

  return match === 'named' || (match === 'bare' && siblings === 0);
}
