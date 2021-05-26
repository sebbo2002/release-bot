export default {
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
        '@semantic-release/changelog',
        'semantic-release-license',
        ['@semantic-release/github', {
            'labels': false,
            'assignees': process.env.GH_OWNER
        }],
        ['@semantic-release/git', {
            'assets': ['CHANGELOG.md', 'LICENSE'],
            'message': 'chore(release): :bookmark: ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}'
        }]
    ]
};
