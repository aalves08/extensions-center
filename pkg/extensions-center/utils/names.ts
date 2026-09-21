/**
 * Turns `owner/rancher-foo-ui-extension` into `Foo`.
 *
 * Extension repos are named with a fair amount of ceremony that nobody wants to
 * read in a table, and there is no other source for a display name: GitHub has
 * no "title" field and the chart name only exists for the eleven official ones.
 */
export function fallbackName(id: string): string {
  const repo = id.split('/')[1] || id;

  const cleaned = repo
    .replace(/[-_](ui[-_])?ext(ension)?s?$/i, '')
    .replace(/^rancher[-_]/i, '')
    .replace(/[-_]ui$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  const base = cleaned || repo;

  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}
