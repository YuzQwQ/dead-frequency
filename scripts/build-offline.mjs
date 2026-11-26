import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
  root,
  configFile: false,
  build: {
    write: false,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: () => true,
    rollupOptions: {
      input: fileURLToPath(new URL('../src/main.ts', import.meta.url)),
      output: {format: 'iife', inlineDynamicImports: true},
    },
  },
});

const [script] = bundle.output.filter(file => file.type === 'chunk');
const [stylesheet] = bundle.output.filter(file => file.type === 'asset' && file.fileName.endsWith('.css'));
if (bundle.output.length !== 2 || !script?.isEntry || !stylesheet) {
  throw new Error('Expected a single script and stylesheet with all other assets inlined.');
}

const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const entryTag = '<script type="module" src="/src/main.ts"></script>';
if (!template.includes(entryTag) || !template.includes('</head>')) {
  throw new Error('Unable to locate the stylesheet and script insertion points in index.html.');
}

const credits = await readFile(new URL('../AUDIO_CREDITS.md', import.meta.url), 'utf8');
const html = template
  .replace('</head>', () => `<style>\n${String(stylesheet.source).replace(/<\/style/gi, '<\\/style')}\n</style>\n</head>`)
  .replace(entryTag, () => `<script>\n${script.code.replace(/<\/script/gi, '<\\/script')}\n</script>`)
  .concat(`\n<!--\n${credits.replace(/-->/g, '--&gt;')}\n-->\n`);

const output = new URL('../死寂频段.html', import.meta.url);
await writeFile(output, html);
console.log(`${fileURLToPath(output)} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB)`);
