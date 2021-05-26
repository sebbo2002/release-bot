const core = require('@actions/core');
const ReleaseBot = require('./release-bot.js');

try {
    const bot = new ReleaseBot();
    bot.run().catch(error => core.setFailed(error.message));
} catch (error) {
    core.setFailed(error.message);
}
