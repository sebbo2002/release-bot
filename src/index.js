import core from '@actions/core';
import ReleaseBot from './release-bot';

try {
    const bot = new ReleaseBot();
    bot.run().catch(error => core.setFailed(error.message));
} catch (error) {
    core.setFailed(error.message);
}
