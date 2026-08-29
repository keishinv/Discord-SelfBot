const { commandInfo, rateInfo, rateWarn } = require("../Utils/logger");
const { getChannel, channelLabel } = require("../Utils/getChannel");
const { getLimiter, routeDelay, isUnknownMessage } = require("../Utils/rateLimiter");
const { parseCount } = require("../Utils/parseCount");
const { Client, Message } = require("discord.js-selfbot-v13");

const FETCH_PAGE_SIZE = 100;
const SNOWFLAKE = /^\d{17,20}$/;
const DEFAULT_SCAN = 100;

/**
 * Remove our own reactions from one message.
 *
 * Uses the `.../reactions/:emoji/@me` route, which only ever touches our own
 * reaction and needs no permissions on the message - so this works on other
 * people's messages, which `delete_message` cannot touch.
 *
 * @returns {Promise<{removed: number, aborted: boolean}>}
 */
async function clearMyReactions(limiter, client, message, channelId) {
    const mine = [...message.reactions.cache.values()].filter((reaction) => reaction.me);
    if (mine.length === 0) return { removed: 0, aborted: false };

    const key = `reaction:${channelId}`;
    const minDelay = routeDelay("reaction");
    let removed = 0;

    for (const reaction of mine) {
        try {
            await limiter.schedule(key, () => reaction.users.remove(client.user), { minDelay });
            removed++;
        } catch (error) {
            // Message deleted, or the emoji no longer exists - either way the
            // reaction is gone, which is the outcome we wanted.
            if (isUnknownMessage(error) || error.code === 10014) continue;

            rateWarn(
                `Failed to remove ${reaction.emoji?.name ?? "reaction"} from ${message.id}: ${error.message}`
            );

            // Access problems repeat for every message in the channel.
            if (error.code === 50001 || error.httpStatus === 401 || error.httpStatus === 403) {
                return { removed, aborted: true };
            }
        }
    }

    return { removed, aborted: false };
}

/**
 * Scan recent messages in a channel and remove every reaction we left on them,
 * regardless of who wrote the message.
 *
 * @param {Client} client
 * @param {object} ctx
 * @param {number} scan       how many messages back to look
 * @param {string} channelId
 * @param {string|null} messageId  when set, only this message is processed
 */
async function remove_reactions(client, ctx, scan = DEFAULT_SCAN, channelId = ctx.channelId, messageId = null) {
    const limiter = getLimiter();

    const channel = getChannel(client, channelId);
    if (!channel) {
        rateWarn(`Channel ${channelId} not found or not accessible.`);
        return 0;
    }

    const where = channelLabel(channel, channelId);

    const fetchKey = `fetch:${channelId}`;
    const fetchDelay = routeDelay("fetch");

    let removed = 0;
    let scanned = 0;
    let touched = 0;

    // --- single message ---------------------------------------------------
    if (messageId) {
        let message;
        try {
            message = await limiter.schedule(fetchKey, () => channel.messages.fetch(messageId), {
                minDelay: fetchDelay,
            });
        } catch (error) {
            rateWarn(`Could not fetch message ${messageId}: ${error.message}`);
            return 0;
        }

        const result = await clearMyReactions(limiter, client, message, channelId);
        commandInfo(`Removed ${result.removed} reaction(s) from ${messageId} in ${where}`);
        return result.removed;
    }

    // --- scan history -----------------------------------------------------
    // `all` mode: page back until the channel runs out.
    const unbounded = !Number.isFinite(scan);
    const target = unbounded ? "all" : scan;

    // No banner for `all` - you typed it, you know what it does. The progress
    // counter below is the only thing worth showing.
    if (!unbounded) {
        rateInfo(`Scanning up to ${scan} message(s) in ${where} for my reactions.`);
    }
    process.stdout.write(`Scanned 0/${target}, removed 0`);

    let before;
    let aborted = false;

    while (scanned < scan && !aborted) {
        const limit = Math.min(FETCH_PAGE_SIZE, scan - scanned);

        let page;
        try {
            page = await limiter.schedule(
                fetchKey,
                () => channel.messages.fetch({ limit, ...(before ? { before } : {}) }),
                { minDelay: fetchDelay },
            );
        } catch (error) {
            process.stdout.write("\n");
            rateWarn(`History fetch failed, stopping: ${error.message}`);
            break;
        }

        if (!page || page.size === 0) break;

        const messages = [...page.values()];
        scanned += messages.length;
        // Messages come back newest first; page back from the oldest we saw.
        before = messages[messages.length - 1].id;

        for (const message of messages) {
            // Cheap check first - a message with no reactions of ours costs
            // no requests at all.
            if (!message.reactions?.cache?.size) continue;

            const result = await clearMyReactions(limiter, client, message, channelId);
            if (result.removed > 0) touched++;
            removed += result.removed;

            process.stdout.write(`\rScanned ${scanned}/${target}, removed ${removed} `);

            if (result.aborted) {
                aborted = true;
                break;
            }
        }

        process.stdout.write(`\rScanned ${scanned}/${target}, removed ${removed} `);

        // A short page means we reached the start of the channel.
        if (messages.length < limit) break;
    }

    process.stdout.write("\n");

    const stats = limiter.snapshot();
    commandInfo(
        `Removed ${removed} reaction(s) across ${touched} message(s), ` +
        `scanned ${scanned} in ${where}`
    );
    rateInfo(
        `${stats.requests} requests, ${stats.rateLimitHits} rate limit hit(s), ` +
        `${stats.retries} retr(ies), ${Math.round(stats.waitedMs / 1000)}s spent waiting.`
    );

    return removed;
}


module.exports = {
    remove_reactions: remove_reactions,
    aliases: ["rr", "unreact"],
    description: "Remove your own reactions, including from other people's messages.",
    usage: [
        ["rr", "scan the last 100 messages here"],
        ["rr 500", "scan the last 500 messages here"],
        ["rr 500 <channelId>", "scan the last 500 in another channel"],
        ["rr all", "scan the whole channel"],
        ["rr <messageId>", "just that one message, here"],
        ["rr <messageId> <channelId>", "just that one message, elsewhere"],
    ],
    notes: [
        "Works on messages you did not write - those can't be deleted, so this is the only way to undo your mark.",
        "Messages with no reactions of yours cost no API calls, so a wide scan is mostly cheap.",
        "A 17-20 digit first argument is read as a message ID, anything else as a count.",
    ],
    /**
     * Usage:
     *   rr                        scan the last 100 messages here
     *   rr 500                    scan the last 500 messages here
     *   rr 500 <channelId>        scan the last 500 in another channel
     *   rr all [channelId]        scan the whole channel
     *   rr <messageId>            just that message, here
     *   rr <messageId> <channelId>  just that message, in another channel
     *
     * @param {Client} client
     * @param {Message} ctx
     * @param {Array} args
     */
    async execute(client, ctx, ...args) {
        const first = String(args[0] ?? "");

        // A snowflake in the first slot means "this one message"; anything
        // else is a scan count, where "all" means the whole channel.
        const messageId = SNOWFLAKE.test(first) ? first : null;
        const scan = messageId ? 0 : parseCount(first, DEFAULT_SCAN);
        const channelId = args[1] || ctx.channelId;

        await remove_reactions(client, ctx, scan, channelId, messageId);
    }
}
