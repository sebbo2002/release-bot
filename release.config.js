module.exports = {
    'branches': [
        'main',
        {
            'name': 'develop',
            'channel': 'next',
            'prerelease': true
        }
    ],
    'plugins': [
        ['@semantic-release/commit-analyzer', {
            'releaseRules': [
                {'type': 'build', 'scope': 'deps', 'release': 'patch'},
                {'type': 'docs', 'release': 'patch'}
            ]
        }],
        '@semantic-release/release-notes-generator',
        ['@semantic-release/exec', {
            'prepareCmd': 'npm run build'
        }],
        '@semantic-release/changelog',
        'semantic-release-license',
        ['@amanda-mitchell/semantic-release-npm-multiple', {
            'registries': {
                'github': {}
            }
        }],
        ['@semantic-release/github', {
            'labels': false,
            'assignees': process.env.GH_OWNER
        }],
        ['@semantic-release/git', {
            'assets': ['CHANGELOG.md', 'LICENSE', 'dist/index.js'],
            'message': 'chore(release): :bookmark: ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}'
        }]
    ]
};
