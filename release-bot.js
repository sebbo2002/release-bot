const core = require('@actions/core');
const github = require('@actions/github');
const git = require('simple-git')();
const semanticRelease = require('semantic-release');
const {Buffer} = require('buffer');

class ReleaseBot {
    constructor() {
        const token = core.getInput('token');

        this.branches = [core.getInput('develop-branch'), core.getInput('release-branch')];
        this.minReleaseAge = parseInt(core.getInput('min-release-age'), 10) * 24 * 60 * 60 * 1000;
        this.assignees = core.getInput('assignee')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        this.client = github.getOctokit(token);
        this.context = github.context;
    }

    async run() {

        // https://api.github.com/repos/sebbo2002/ical-generator/compare/main...develop
        const diff = await this.client.repos.compareCommits({
            ...this.context.repo,
            base: this.branches[1],
            head: this.branches[0]
        });
        if(diff.data.ahead_by === 0) {
            core.info('There\'s nothing to commit, bye…');
            return;
        }

        // https://api.github.com/repos/sebbo2002/ical-generator/commits?sha=main&per_page=5&page=1
        const commits = await this.client.repos.listCommits({
            ...this.context.repo,
            sha: this.branches[1],
            per_page: 5,
            page: 1
        });
        if(commits.data.length > 0) {
            const latestCommit = commits.data[0].commit;
            const latestCommitDate = new Date(latestCommit.committer.date);
            if(latestCommitDate.getTime() > new Date().getTime() - this.minReleaseAge) {
                core.info('Last commit in release branch is quite new:');
                core.info(`${latestCommit.message} (${latestCommit.html_url.substr(latestCommit.html_url.length - 40 + 8)})`);
                core.info('Woun\'t create a new release, bye…');
                return;
            }
        }

        core.startGroup('Prepare fake release for semantic-release');

        await git.addConfig('user.email', 'chetengohgheihaidabo@e.sebbo.net');
        await git.addConfig('user.name', 'ReleaseBot');

        // Checkout release branch
        try {
            await git.fetch(['--unshallow']);
        }
        catch(error) {
            if(!String(error).includes('--unshallow on a complete repository does not make sense')) {
                throw error;
            }
        }

        // Create fake release branch
        await git.checkout(this.branches[1]);
        await git.branch(['release-bot']);

        // Checkout development branch
        await git.checkout(this.branches[0]);
        await git.pull('origin', this.branches[0]);

        // merge
        await git.mergeFromTo(this.branches[0], this.branches[1]);

        // Push fake branch to repo for semantic-release
        await git.push('origin', 'release-bot');
        core.endGroup();

        core.startGroup('Run Semantic Release');
        const release = await semanticRelease({
            branches: [...this.branches, 'release-bot'],
            plugins: ['@semantic-release/commit-analyzer', '@semantic-release/release-notes-generator'],
            dryRun: true
        });

        await git.push(['origin', '--delete', 'release-bot']);

        core.endGroup();
        core.info('');

        if(!release.nextRelease) {
            core.info('No release required, stop here…');
            return;
        }

        const lastReleaseCommit = await this.client.git.getCommit({
            ...this.context.repo,
            commit_sha: release.lastRelease.gitHead
        });

        // https://api.github.com/repos/sebbo2002/ical-generator/pulls?state=open&head=develop&base=main
        let pr = null;
        const prs = await this.client.pulls.list({
            ...this.context.repo,
            base: this.branches[1],
            head: this.branches[0],
            sort: 'updated',
            direction: 'desc',
            per_page: 1,
            page: 1
        });
        if(prs.data.length > 0) {
            pr = prs.data[0];
            core.info(`Found at least one pull request, will reuse #${pr.number}`);
        }
        if(pr && pr.user.login !== 'github-actions[bot]') {
            core.info(`Pull request #${pr.number} was not created by this bot. Ignore PR and stop here…`);
            return;
        }

        let dependencies = {};
        try {
            dependencies = await this.getModuleDiff(this.context.repo);
        }
        catch(error) {
            core.warning('Unable to get package.json: ' + error.stack);
        }

        const title = `🎉 ${release.nextRelease.version}`;
        let body = `### ℹ️ About this release\n` +
            `* **Version**: ${release.nextRelease.version}\n` +
            `* **Type**: ${release.nextRelease.type}\n` +
            `* **Last Release**: ${release.lastRelease.version} `+
            `(${new Date(lastReleaseCommit.data.committer.date).toLocaleString()}) `+
            `[[?](${lastReleaseCommit.data.html_url})]\n` +
            `* **Commits to merge**: ${diff.data.ahead_by} [[?](${diff.data.permalink_url})]` +
            '\n' + release.nextRelease.notes
                .substr(release.nextRelease.notes.indexOf('\n'))
                .replace('### Bug Fixes\n', '### 🐛 Bug Fixes\n')
                .replace('### Code Refactoring\n', '### 🚧 Code Refactoring\n')
                .replace('### Features\n', '### 🆕 Features\n')
                .replace('### BREAKING CHANGES\n', '### ⚡️ BREAKING CHANGES\n')
                .trim();


        [
            ['dependencies', 'Dependencies'],
            ['devDependencies', 'Development Dependencies'],
            ['peerDependencies', 'Peer Dependencies'],
            ['bundledDependencies', 'Bundled Dependencies'],
            ['optionalDependencies', 'Optional Dependencies']
        ].forEach(([type, name]) => {
            if(dependencies[type]) {
                body += `\n\n### 📦 ${name}\n` + dependencies[type].join('\n');
            }
        });

        if(pr) {
            await this.client.pulls.update({
                ...this.context.repo,
                pull_number: pr.number,
                title,
                body
            });

            core.info(`🎉 Updated Pull Request ${pr.number}:`);
        } else {
            const c = await this.client.pulls.create({
                ...this.context.repo,
                base: this.branches[1],
                head: this.branches[0],
                title,
                body
            });
            pr = c.data;

            if(this.assignees.length) {
                await this.client.issues.addAssignees({
                    ...this.context.repo,
                    issue_number: pr.number,
                    assignees: this.assignees
                });
            }

            core.info(`🎉 Created Pull Request #${pr.number}:`);
        }

        core.info('   ' + pr.html_url);
        core.info('');
        core.startGroup('PR Content');
        console.log('#', title, '\n');
        console.log(body);
        core.endGroup();
        core.info('');
    }

    async getModuleDiff(context) {
        const result = {};
        const [newPackage, oldPackage] = await Promise.all(this.branches.map(async branch => {
            const {data} = await this.client.repos.getContent({
                ...context,
                path: 'package.json',
                ref: branch
            });

            return JSON.parse(Buffer.from(data.content, 'base64').toString());
        }));

        [
            'dependencies',
            'devDependencies',
            'peerDependencies',
            'bundledDependencies',
            'optionalDependencies'
        ].forEach(type => {
            Object.entries(newPackage[type] || {})
                .forEach(([dependency, newVersion]) => {
                    const oldVersion = oldPackage[type][dependency];
                    if(!oldVersion) {
                        result[type] = result[type] || [];
                        result[type].push(`* Added \`${dependency}\` \`${newVersion}\``);
                    }
                });

            Object.entries(oldPackage[type] || {})
                .forEach(([dependency, oldVersion]) => {
                    const newVersion = newPackage[type][dependency];
                    if(newVersion && newVersion !== oldVersion) {
                        result[type] = result[type] || [];
                        result[type].push(`* Update \`${dependency}\` from\`${oldVersion}\` to \`${newVersion}\``);
                    }
                });

            Object.entries(oldPackage[type] || {})
                .forEach(([dependency]) => {
                    const newVersion = newPackage[type][dependency];
                    if(!newVersion) {
                        result[type] = result[type] || [];
                        result[type].push(`* Removed \`${dependency}\``);
                    }
                });
        });
        
        return result;
    }
}

module.exports = ReleaseBot;
