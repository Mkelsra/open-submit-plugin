const terser = require('@rollup/plugin-terser')
const typescript = require('@rollup/plugin-typescript')
const copy = require('rollup-plugin-copy-glob')

const is_production = process.env.NODE_ENV === 'production';

module.exports = [
  {
    input: './src/pond5/submit.ts',
    output: {
      file: 'build/pond5/submit.js',
      format: 'es',
      plugins: is_production ? [terser()] : []
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
  {
    input: './src/dreamstime/submit.ts',
    output: {
      file: 'build/dreamstime/submit.js',
      format: 'es',
      plugins: is_production ? [terser()] : []
    },
    plugins: [
      typescript(),
      copy([
        { files: 'src/dreamstime/*.json', dest: 'build/dreamstime' },
      ], {
        verbose: true,
        watch: true
      })
    ]
  },
  {
    input: './src/dreamstime/checkAuth.ts',
    output: {
      file: 'build/dreamstime/checkAuth.js',
      format: 'es',
      plugins: is_production ? [terser()] : []
    },
    plugins: [
      typescript(),
    ]
  }
];