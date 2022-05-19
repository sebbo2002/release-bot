const core = require('@actions/core');
const github = require('@actions/github');
const git = require('simple-git')();
const semanticRelease = require('semantic-release');
const {cosmiconfig} = require('cosmiconfig');
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
        const diff = await this.client.rest.repos.compareCommits({
            ...this.context.repo,
            base: this.branches[1],
            head: this.branches[0]
        });
        if(diff.data.ahead_by === 0) {
            core.info('There\'s nothing to commit, bye…');
            return;
        }

        // https://api.github.com/repos/sebbo2002/ical-generator/commits?sha=main&per_page=5&page=1
        const commits = await this.client.rest.repos.listCommits({
            ...this.context.repo,
            sha: this.branches[1],
            per_page: 5,
            page: 1
        });
        let draft = false;
        if(commits.data.length > 0) {
            const latestCommit = commits.data[0].commit;
            const latestCommitDate = new Date(latestCommit.committer.date);
            if(latestCommitDate.getTime() > new Date().getTime() - this.minReleaseAge) {
                core.info('Last commit in release branch is quite new, will do a PR draft only…');
                draft = true;
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

        // Generate plugin list with project configuration
        core.startGroup('Generate semantic release configuration');
        const {config, filepath} = (await cosmiconfig('release').search()) || {};
        let plugins = ['@semantic-release/commit-analyzer', '@semantic-release/release-notes-generator'];
        if (config && filepath) {
            core.info(`Use semantic-release configuration file ${filepath}`);
            plugins = plugins.map(pluginName => {
                const pluginConfig = config?.plugins?.find(config => Array.isArray(config) && config[0] === pluginName);
                return pluginConfig ? [pluginName, pluginConfig[1]] : pluginName;
            });
        }
        core.info(JSON.stringify(plugins, null, '  '));
        core.endGroup();

        core.startGroup('Run semantic-release');
        const release = await semanticRelease({
            branches: [...this.branches, 'release-bot'],
            plugins,
            dryRun: true
        });

        await git.push(['origin', '--delete', 'release-bot']);
        core.endGroup();

        core.startGroup('semantic-release Output');
        core.info(JSON.stringify(release, null, '  '));
        core.endGroup();

        if(!release.nextRelease) {
            core.info('');
            core.info('No release required, stop here…');
            return;
        }

        core.startGroup('Get Commit of last release');
        const lastReleaseCommit = release.lastRelease && release.lastRelease.gitHead ? await this.client.rest.git.getCommit({
            ...this.context.repo,
            commit_sha: release.lastRelease.gitHead
        }) : null;
        core.info(JSON.stringify(lastReleaseCommit, null, '  '));
        core.endGroup();


        core.startGroup('Get user of provided token');
        let tokenUserName = 'github-actions[bot]';
        try {
            const user = await this.client.rest.users.getAuthenticated();
            core.info(JSON.stringify(user.data, null, '  '));
            tokenUserName = user.data.login;
        }
        catch(error) {
            core.info(String(error));
            core.info(`Use default user name (= ${tokenUserName})`);
        }
        core.endGroup();


        // https://api.github.com/repos/sebbo2002/ical-generator/pulls?state=open&head=develop&base=main
        let pr = null;
        core.startGroup('Check pull requests');
        const prs = await this.client.rest.pulls.list({
            ...this.context.repo,
            base: this.branches[1],
            head: this.branches[0],
            sort: 'updated',
            direction: 'desc',
            per_page: 1,
            page: 1
        });
        core.info(JSON.stringify(prs.data, null, '  '));
        core.info('');

        if(prs.data.length > 0) {
            pr = prs.data[0];
            core.info(`Found at least one pull request, will reuse #${pr.number}`);
        }
        if(pr && pr.user.login !== this.context.actor && pr.user.login !== tokenUserName) {
            core.endGroup();
            core.info('');
            core.info(`Pull request #${pr.number} was not created by this bot. Ignore PR and stop here…`);
            return;
        }
        core.endGroup();
        core.info('');

        let dependencies = {};
        try {
            dependencies = await this.getModuleDiff(this.context.repo);
        }
        catch(error) {
            core.warning('Unable to get package.json: ' + error.stack);
        }

        const title = `🎉 ${release.nextRelease.version}`;
        let body = '### ℹ️ About this release\n' +
            `* **Version**: ${release.nextRelease.version}\n` +
            `* **Type**: ${release.nextRelease.type}\n` +
            '* **Last Release**: ' + (release.lastRelease && lastReleaseCommit ? (
            `${release.lastRelease.version} (${new Date(lastReleaseCommit.data.committer.date).toLocaleString()}) `+
                `[[?](${lastReleaseCommit.data.html_url})]\n`
        ) : '-\n') +
            `* **Commits to merge**: ${diff.data.ahead_by} [[?](${diff.data.permalink_url})]\n`;

        if (!release.nextRelease.version.startsWith('1.0.0')) {
            const notes = release.nextRelease.notes
                .substr(release.nextRelease.notes.indexOf('\n'))
                .replace('### Bug Fixes\n', '### 🐛 Bug Fixes\n')
                .replace('### Code Refactoring\n', '### 🚧 Code Refactoring\n')
                .replace('### Features\n', '### 🆕 Features\n')
                .replace('### BREAKING CHANGES\n', '### ⚡️ BREAKING CHANGES\n')
                .trim();

            body += notes;

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

            if(
                !notes &&
                !dependencies.dependencies &&
                !dependencies.peerDependencies &&
                !dependencies.bundledDependencies &&
                !dependencies.optionalDependencies
            ) {
                core.info('Empty release notes and no relevant dependency changes, mark PR as a draft…');
                draft = true;
            }
        }

        if(pr) {
            await this.client.rest.pulls.update({
                ...this.context.repo,
                pull_number: pr.number,
                title,
                body
            });

            core.info(`🎉 Updated Pull Request ${pr.number}:`);
        } else {
            const c = await this.client.rest.pulls.create({
                ...this.context.repo,
                base: this.branches[1],
                head: this.branches[0],
                title,
                body,
                draft
            });
            pr = c.data;

            core.info(`🎉 Created Pull Request #${pr.number}:`);
        }

        if(!draft && this.assignees.length) {
            await this.client.rest.issues.addAssignees({
                ...this.context.repo,
                issue_number: pr.number,
                assignees: this.assignees
            });
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
            const {data} = await this.client.rest.repos.getContent({
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
                    if(!oldPackage[type] || !oldPackage[type][dependency]) {
                        result[type] = result[type] || [];
                        result[type].push(`* Added \`${dependency}\` \`${newVersion}\``);
                    }
                });

            Object.entries(oldPackage[type] || {})
                .forEach(([dependency, oldVersion]) => {
                    const newVersion = newPackage[type] ? newPackage[type][dependency] : null;
                    if(newVersion && newVersion !== oldVersion) {
                        result[type] = result[type] || [];
                        result[type].push(`* Update \`${dependency}\` from \`${oldVersion}\` to \`${newVersion}\``);
                    }
                });

            Object.entries(oldPackage[type] || {})
                .forEach(([dependency]) => {
                    const newVersion = newPackage[type] ? newPackage[type][dependency] : null;
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
