import { parseImports } from '../importParser';

/** Just the module specifiers, in the order the parser reports them. */
function sources(file: string, content: string): string[] {
  return parseImports(file, content).map((i) => i.source);
}

/** Specifiers recorded against one source, deduplicated by the parser. */
function specifiersFor(file: string, content: string, source: string): string[] {
  return parseImports(file, content).find((i) => i.source === source)?.specifiers || [];
}

describe('parseImports — statement forms', () => {
  it('finds a default import', () => {
    expect(sources('a.ts', `import Vue from 'vue';`)).toEqual(['vue']);
  });

  it('finds a named import', () => {
    expect(sources('a.ts', `import { ref } from 'vue';`)).toEqual(['vue']);
  });

  it('finds a side-effect import', () => {
    expect(sources('a.ts', `import 'polyfill';`)).toEqual(['polyfill']);
  });

  it('finds a namespace import', () => {
    expect(sources('a.ts', `import * as path from 'path';`)).toEqual(['path']);
  });

  it('finds a re-export', () => {
    expect(sources('a.ts', `export { a } from './thing';`)).toEqual(['./thing']);
  });

  it('finds a star re-export', () => {
    expect(sources('a.ts', `export * from './thing';`)).toEqual(['./thing']);
  });

  it('finds a dynamic import', () => {
    expect(sources('a.ts', `const m = import('./lazy');`)).toEqual(['./lazy']);
  });

  it('handles double and single quotes alike', () => {
    expect(sources('a.ts', `import a from "vue";`)).toEqual(['vue']);
  });

  it('spans a multi-line import list', () => {
    const src = `import {
  ref,
  computed,
} from 'vue';`;

    expect(sources('a.ts', src)).toEqual(['vue']);
  });

  it('finds several imports in one file, in order', () => {
    const src = `import a from 'one';
import b from 'two';
import 'three';`;

    expect(sources('a.ts', src)).toEqual(['one', 'two', 'three']);
  });

  it('finds an import that follows a semicolon on the same line', () => {
    expect(sources('a.ts', `const x = 1; import a from 'vue';`)).toEqual(['vue']);
  });

  it('reports a source imported twice twice', () => {
    const src = `import { a } from 'vue';
import { b } from 'vue';`;

    expect(sources('a.ts', src)).toEqual(['vue', 'vue']);
  });

  it('deliberately ignores require()', () => {
    // Build config (`vue.config.js`) uses it; counting those would invent
    // dependencies no extension actually ships.
    expect(sources('a.ts', `const x = require('lodash');`)).toEqual([]);
  });

  it('returns nothing for a file with no imports', () => {
    expect(sources('a.ts', 'export const x = 1;')).toEqual([]);
  });

  it('returns nothing for empty content', () => {
    expect(sources('a.ts', '')).toEqual([]);
  });

  it('puts dynamic imports after static ones', () => {
    const src = `import a from 'static';
const b = import('dynamic');`;

    expect(sources('a.ts', src)).toEqual(['static', 'dynamic']);
  });
});

describe('parseImports — Vue SFCs', () => {
  it('reads imports out of a script block', () => {
    const sfc = `<template><div /></template>
<script>
import { ref } from 'vue';
</script>`;

    expect(sources('Comp.vue', sfc)).toEqual(['vue']);
  });

  it('reads both script and script setup blocks', () => {
    // Reading only the first block silently loses half the imports.
    const sfc = `<script>
import { defineComponent } from 'vue';
</script>
<script setup lang="ts">
import Banner from '@components/Banner';
</script>`;

    expect(sources('Comp.vue', sfc)).toEqual(['vue', '@components/Banner']);
  });

  it('ignores template and style content', () => {
    const sfc = `<template>
  <div>import fake from 'not-real';</div>
</template>
<style>@import 'also-not-real';</style>
<script>
import real from 'real';
</script>`;

    expect(sources('Comp.vue', sfc)).toEqual(['real']);
  });

  it('returns nothing for an SFC with no script block', () => {
    expect(sources('Comp.vue', '<template><div /></template>')).toEqual([]);
  });

  it('is case-insensitive about the .vue extension', () => {
    const sfc = `<script>import a from 'vue';</script>`;

    expect(sources('Comp.VUE', sfc)).toEqual(['vue']);
  });

  it('is reusable across calls despite the module-level regexes', () => {
    // The SCRIPT_BLOCK regex is global and shared; a missed lastIndex reset
    // would make the second call return nothing.
    const sfc = `<script>import a from 'vue';</script>`;

    expect(sources('A.vue', sfc)).toEqual(['vue']);
    expect(sources('B.vue', sfc)).toEqual(['vue']);
    expect(sources('C.vue', sfc)).toEqual(['vue']);
  });
});

describe('parseImports — specifiers', () => {
  it('lists named specifiers', () => {
    expect(specifiersFor('a.ts', `import { ref, computed } from 'vue';`, 'vue'))
      .toEqual(['ref', 'computed']);
  });

  it('records the exported name, not the local alias', () => {
    expect(specifiersFor('a.ts', `import { ref as r } from 'vue';`, 'vue')).toEqual(['ref']);
  });

  it('strips an inline type modifier', () => {
    expect(specifiersFor('a.ts', `import { type Foo, bar } from 'x';`, 'x')).toEqual(['Foo', 'bar']);
  });

  it('records a namespace import as *', () => {
    expect(specifiersFor('a.ts', `import * as ns from 'x';`, 'x')).toEqual(['*']);
  });

  it('records a default import as default', () => {
    expect(specifiersFor('a.ts', `import Thing from 'x';`, 'x')).toEqual(['default']);
  });

  it('records a default alongside named specifiers', () => {
    expect(specifiersFor('a.ts', `import Thing, { a, b } from 'x';`, 'x'))
      .toEqual(['a', 'b', 'default']);
  });

  it('has no specifiers for a side-effect import', () => {
    expect(specifiersFor('a.ts', `import 'x';`, 'x')).toEqual([]);
  });

  it('merges and deduplicates specifiers across two imports of one source', () => {
    const src = `import { a } from 'x';
import { a, b } from 'x';`;

    expect(specifiersFor('a.ts', src, 'x')).toEqual(['a', 'b']);
  });

  it('handles specifiers spread over several lines', () => {
    const src = `import {
  alpha,
  beta as b,
} from 'x';`;

    expect(specifiersFor('a.ts', src, 'x')).toEqual(['alpha', 'beta']);
  });
});
