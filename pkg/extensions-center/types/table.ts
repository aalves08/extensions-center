/**
 * Column definition accepted by `@shell/components/SortableTable`.
 *
 * SortableTable takes plain objects and does not export a type for them, so
 * this covers the options the extension's tables use.
 */
export interface TableHeader {
  /** Matches the `cell:<name>` / `col:<name>` slot */
  name: string;
  label?: string;
  labelKey?: string;
  /** Dot path into the row used for sorting, searching and the default cell */
  value?: string;
  /** Sort fields, or false to make the column unsortable */
  sort?: string[] | string | false;
  align?: 'left' | 'center' | 'right';
  width?: number;
  tooltip?: string;
  formatter?: string;
}
