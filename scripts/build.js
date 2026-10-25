import esbuild from 'esbuild'
import { writeFileSync } from 'node:fs'

const result = await esbuild.build({
  entryPoints: ['src/client/podcast.js'],
  bundle: true,
  format: 'iife',
  outfile: 'client/podcast.js',
  sourcemap: true,
  minify: true,
  metafile: true,
})
writeFileSync('meta-client.json', JSON.stringify(result.metafile))
console.log('built client/podcast.js')
