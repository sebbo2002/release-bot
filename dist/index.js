'use strict';

var core = require('@actions/core');
var github = require('@actions/github');
var Git = require('simple-git');
var semanticRelease = require('semantic-release');
var buffer = require('buffer');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var core__default = /*#__PURE__*/_interopDefaultLegacy(core);
var github__default = /*#__PURE__*/_interopDefaultLegacy(github);
var Git__default = /*#__PURE__*/_interopDefaultLegacy(Git);
var semanticRelease__default = /*#__PURE__*/_interopDefaultLegacy(semanticRelease);

const git = Git__default['default']();

class ReleaseBot {
    constructor() {
        const token = core__default['default'].getInput('token');

        this.branches = [core__default['default'].getInput('develop-branch'), core__default['default'].getInput('release-branch')];
        this.minReleaseAge = parseInt(core__default['default'].getInput('min-release-age'), 10) * 24 * 60 * 60 * 1000;
        this.assignees = core__default['default'].getInput('assignee')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        this.client = github__default['default'].getOctokit(token);
        this.context = github__default['default'].context;
    }

    async run() {

        // https://api.github.com/repos/sebbo2002/ical-generator/compare/main...develop
        const diff = await this.client.repos.compareCommits({
            ...this.context.repo,
            base: this.branches[1],
            head: this.branches[0]
        });
        if(diff.data.ahead_by === 0) {
            core__default['default'].info('There\'s nothing to commit, bye…');
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
                core__default['default'].info('Last commit in release branch is quite new');
                core__default['default'].info('Woun\'t create a new release, bye…');
                return;
            }
        }

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


        core__default['default'].startGroup('Run Semantic Release');
        const release = await semanticRelease__default['default']({
            branches: [...this.branches, 'release-bot'],
            plugins: ['@semantic-release/commit-analyzer', '@semantic-release/release-notes-generator'],
            dryRun: true
        });

        await git.push(['origin', '--delete', 'release-bot']);
        core__default['default'].endGroup();

        core__default['default'].startGroup('Semantic Release Output');
        core__default['default'].info(JSON.stringify(release, null, '  '));
        core__default['default'].endGroup();

        if(!release.nextRelease) {
            core__default['default'].info('');
            core__default['default'].info('No release required, stop here…');
            return;
        }

        core__default['default'].startGroup('Get Commit of last release');
        const lastReleaseCommit = release.lastRelease && release.lastRelease.gitHead ? await this.client.git.getCommit({
            ...this.context.repo,
            commit_sha: release.lastRelease.gitHead
        }) : null;
        core__default['default'].info(JSON.stringify(lastReleaseCommit, null, '  '));
        core__default['default'].endGroup();


        // https://api.github.com/repos/sebbo2002/ical-generator/pulls?state=open&head=develop&base=main
        let pr = null;
        core__default['default'].startGroup('Check pull requests');
        const prs = await this.client.pulls.list({
            ...this.context.repo,
            base: this.branches[1],
            head: this.branches[0],
            sort: 'updated',
            direction: 'desc',
            per_page: 1,
            page: 1
        });
        core__default['default'].info(JSON.stringify(prs.data, null, '  '));
        core__default['default'].info('');

        if(prs.data.length > 0) {
            pr = prs.data[0];
            core__default['default'].info(`Found at least one pull request, will reuse #${pr.number}`);
        }
        if(pr && pr.user.login !== 'github-actions[bot]') {
            core__default['default'].endGroup();
            core__default['default'].info('');
            core__default['default'].info(`Pull request #${pr.number} was not created by this bot. Ignore PR and stop here…`);
            return;
        }
        core__default['default'].endGroup();
        core__default['default'].info('');

        let dependencies = {};
        try {
            dependencies = await this.getModuleDiff(this.context.repo);
        }
        catch(error) {
            core__default['default'].warning('Unable to get package.json: ' + error.stack);
        }

        const title = `🎉 ${release.nextRelease.version}`;
        let body = `### ℹ️ About this release\n` +
            `* **Version**: ${release.nextRelease.version}\n` +
            `* **Type**: ${release.nextRelease.type}\n` +
            `* **Last Release**: ` + (release.lastRelease && lastReleaseCommit ? (
                `${release.lastRelease.version} (${new Date(lastReleaseCommit.data.committer.date).toLocaleString()}) `+
                `[[?](${lastReleaseCommit.data.html_url})]\n`
            ) : '-\n') +
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

            core__default['default'].info(`🎉 Updated Pull Request ${pr.number}:`);
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

            core__default['default'].info(`🎉 Created Pull Request #${pr.number}:`);
        }

        core__default['default'].info('   ' + pr.html_url);
        core__default['default'].info('');
        core__default['default'].startGroup('PR Content');
        console.log('#', title, '\n');
        console.log(body);
        core__default['default'].endGroup();
        core__default['default'].info('');
    }

    async getModuleDiff(context) {
        const result = {};
        const [newPackage, oldPackage] = await Promise.all(this.branches.map(async branch => {
            const {data} = await this.client.repos.getContent({
                ...context,
                path: 'package.json',
                ref: branch
            });

            return JSON.parse(buffer.Buffer.from(data.content, 'base64').toString());
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
                        result[type].push(`* Update \`${dependency}\` from \`${oldVersion}\` to \`${newVersion}\``);
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

try {
    const bot = new ReleaseBot();
    bot.run().catch(error => core__default['default'].setFailed(error.message));
} catch (error) {
    core__default['default'].setFailed(error.message);
}
