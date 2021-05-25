export default {
    input: 'src/index.js',
    output: {
        file: 'dist/index.js',
        format: 'cjs'
    },
    external: [
        '@actions/core',
        '@actions/github',
        'simple-git',
        'semantic-release',
        'buffer'
    ]
};
