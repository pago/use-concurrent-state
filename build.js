const { build } = require('esbuild');

const external = [
  'use-immer',
  'react',
  '@pago/use-reference',
  'is-generator-function',
];

const esmBuild = build({
  entryPoints: ['./src/index.ts'],
  format: 'esm',
  target: 'es2018',
  bundle: true,
  outfile: './dist/use-concurrent-state.esm.js',
  sourcemap: true,
  minify: true,
  external,
});

const cjsBuild = build({
  entryPoints: ['./src/index.ts'],
  format: 'cjs',
  target: 'es2018',
  bundle: true,
  outfile: './dist/index.js',
  sourcemap: true,
  minify: true,
  external,
});

Promise.all([esmBuild, cjsBuild]).catch(function handleFailure(reason) {
  console.error('BUILD FAILED');
  console.error(reason);
  process.exit(1);
});
