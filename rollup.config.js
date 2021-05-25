export default {
    input: 'src/index.js',
    output: {
        file: 'index.js',
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
