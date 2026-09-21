/**
 * Curated links rendered by the "Important Links" card.
 *
 * Labels are intentionally plain strings rather than translation keys: they are
 * page titles from Confluence and are not translated upstream.
 */
export interface ImportantLink {
  label: string;
  description: string;
  url: string;
}

export const IMPORTANT_LINKS: ImportantLink[] = [
  {
    label:       'Extensions',
    description: 'Top-level extensions documentation space.',
    url:         'https://confluence.suse.com/spaces/CU/pages/1189511436/Extensions',
  },
  {
    label:       'Current extension workflows',
    description: 'What each shared workflow does and when it runs.',
    url:         'https://confluence.suse.com/spaces/CU/pages/2146828343/Current+extension+workflows',
  },
  {
    label:       'Extension Catalog Images (ECI)',
    description: 'How Extension Catalog Images work end to end.',
    url:         'https://confluence.suse.com/spaces/CU/pages/2158461176/Extension+Catalog+Images+ECI+%E2%80%94+how+they+work+end+to+end',
  },
  {
    label:       'Extensions backend',
    description: 'How the backend part of extensions works.',
    url:         'https://confluence.suse.com/spaces/CU/pages/2146828345/How+does+the+backend+part+of+extensions+work',
  },
  {
    label:       'Extensions architecture',
    description: 'Current extensions architecture overview.',
    url:         'https://confluence.suse.com/spaces/CU/pages/1691779146/Current+extensions+architecture',
  },
];

/** Public dev docs, linked from the actions card */
export const EXTENSIONS_DOCS_URL = 'https://extensions.rancher.io/extensions/next/home';
