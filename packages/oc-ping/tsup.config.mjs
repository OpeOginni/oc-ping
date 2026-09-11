import { defineConfig } from 'tsup'
import { readFile, writeFile } from 'node:fs/promises'
import { transformAsync } from '@babel/core'
import typescript from '@babel/preset-typescript'
import solid from 'babel-preset-solid'

export default defineConfig({
  entry: ['src/*.ts', 'src/*.tsx'],
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  bundle: false,
  sourcemap: true,
  esbuildPlugins: [{
    name: 'solid-tui',
    setup(build) {
      build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
        const result = await transformAsync(await readFile(path, 'utf8'), {
          filename: path,
          configFile: false,
          babelrc: false,
          presets: [
            [solid, { moduleName: '@opentui/solid', generate: 'universal' }],
            [typescript, { onlyRemoveTypeImports: true }],
          ],
        })
        if (!result?.code) throw new Error(`Could not compile ${path}`)
        return { contents: result.code, loader: 'js' }
      })
    },
  }],
  async onSuccess() {
    const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
    await writeFile(new URL('./dist/package.json', import.meta.url), `${JSON.stringify({
      name: pkg.name,
      version: pkg.version,
      type: 'module',
      main: './index.js',
      exports: { '.': './index.js', './tui': './tui.js' },
      dependencies: pkg.dependencies,
      peerDependencies: pkg.peerDependencies,
    }, null, 2)}\n`)
  },
})
