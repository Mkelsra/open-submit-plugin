const terser = require('@rollup/plugin-terser')
const typescript = require('@rollup/plugin-typescript')
const copy = require('rollup-plugin-copy-glob')

module.exports = [
  {
    input: './src/pond5/submit.ts',
    output: {
      file: 'build/pond5/submit.js',
      format: 'es',
			plugins: [terser()]
    },    
    plugins: [
      typescript(),
      copy([
        { files: 'src/*.json', dest: 'build' },
        { files: 'src/*.png', dest: 'build' },
        { files: 'src/pond5/*.json', dest: 'build/pond5' },
      ], {
          verbose: true, 
          watch: true
      })
    ]
  },
];