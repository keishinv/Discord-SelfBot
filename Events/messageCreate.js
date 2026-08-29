const { Client, Message } = require("discord.js-selfbot-v13");
const config = require('../config');
const { getLimiter, routeDelay, isUnknownMessage } = require("../Utils/rateLimiter");
const { getQueue } = require("../Utils/commandQueue");
const { rateWarn } = require("../Utils/logger");

module.exports = {
    once: false,
    /**
     * @param {Client} client
     * @param {Message} ctx
     */
    async execute(ctx, client) {
        if (ctx.author.id !== client.user.id) return;
        let content = ctx.content;

        if (!content.toLowerCase().startsWith(config.user.prefix)) return;

        const args = content.slice(config.user.prefix.length).trim().split(/ +/g);
        const commandName = args.shift().toLowerCase();
        let command;

        if (client.commands.has(commandName)) command = client.commands.get(commandName);
        else if (client.aliases.has(commandName)) command = client.aliases.get(commandName);

        // Clean up the invocation through the limiter, and await it - firing
        // this off unawaited alongside the command's own requests is how a
        // burst of commands turns into a 429. Deliberately not queued: the
        // message should disappear now, not after a three-hour sweep.
        const limiter = getLimiter();
        try {
            await limiter.schedule(`delete:${ctx.channelId}`, () => ctx.delete(), {
                minDelay: routeDelay("delete"),
            });
        } catch (error) {
            if (!isUnknownMessage(error)) {
                rateWarn(`Could not delete command message: ${error.message}`);
            }
        }

        if (!command) return;

        // Commands that make no API calls and finish instantly skip the queue,
        // so `help` and `queue` still answer while a long sweep is running.
        if (command.queued === false) {
            await command.execute(client, ctx, ...args);
            return;
        }

        const label = [commandName, ...args].join(" ");
        await getQueue().add(label, () => command.execute(client, ctx, ...args));
    }
}
