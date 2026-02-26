import * as core from '@actions/core';
import ReleaseBot from './release-bot.js';

try {
    const bot = new ReleaseBot();
    bot.run().catch(error => core.setFailed(error.message));
} catch (error) {
    core.setFailed(error.message);
}
