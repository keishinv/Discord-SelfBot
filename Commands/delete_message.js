const { commandInfo, rateInfo, rateWarn } = require("../Utils/logger");
const { getChannel, channelLabel } = require("../Utils/getChannel");
const { getLimiter, routeDelay, isUnknownMessage } = require("../Utils/rateLimiter");
const { parseCount } = require("../Utils/parseCount");
const { Client, Message } = require("discord.js-selfbot-v13");

// Search is eventually consistent: a message can keep showing up in results
// for a while after it is deleted. If that many rounds in a row turn up
// nothing new to delete, we are chasing ghosts and should stop rather than
// spinning on the search endpoint.
const MAX_EMPTY_ROUNDS = 3;
// `all` is meant to run to completion, so be more patient with the lagging
// search index before concluding the channel is clear.
const MAX_EMPTY_ROUNDS_ALL = 5;
const SEARCH_PAGE_SIZE = 25;
const HISTORY_PAGE_SIZE = 100;
const DEFAULT_MAX = 20;

/**
 * Turn a failed search into something worth reading in the console.
 *
 * The common one: Discord answers `202 {code: 110000, "Index not yet
 * available"}` for a channel it has not indexed yet - newly created ticket
 * channels especially. The library doesn't check for that and iterates a
 * missing `messages` array, so it surfaces as a TypeError.
 */
function describeSearchFailure(error) {
    if (error instanceof TypeError || /not iterable|no message list/i.test(error.message ?? "")) {
        return "Discord has not indexed this channel for search yet";
    }
    if (error.code === 50001) return "missing access";
    if (error.code === 50013) return "missing permissions";
    return error.message;
}

/**
 * Delete up to `max` of our own messages in a channel. Pass `Infinity` to
 * keep going until none are left.
 *
 * Two ways to find them:
 *
 *   search   asks Discord for just our messages. Cheap on busy channels, but
 *            it depends on the guild search index, which lags behind reality
 *            and is missing entirely for freshly created channels.
 *   history  pages back through the channel and filters locally. Always works
 *            and is exact, but reads every message to find ours.
 *
 * Default is `auto`: history for an unbounded sweep (exactness matters more
 * than speed when the promise is "everything"), search for a bounded one,
 * falling back to history the moment search fails.
 *
 * @param {Client} client
 * @param {object} ctx
 * @param {number} max
 * @param {string} channelId
 * @param {{mode?: "auto"|"search"|"history"}} [options]
 */
async function delete_message(client, ctx, max = DEFAULT_MAX, channelId = ctx.channelId, options = {}) {
    const limiter = getLimiter();

    const channel = getChannel(client, channelId);
    if (!channel) {
        rateWarn(`Channel ${channelId} not found or not accessible.`);
        return 0;
    }

    // Name + id, so a log line says which channel it actually swept.
    const where = channelLabel(channel, channelId);

    // `all` mode: no ceiling, stop only when the channel is clear.
    const unbounded = !Number.isFinite(max);
    const ceiling = unbounded ? Infinity : Math.max(1, Math.floor(max));
    const target = unbounded ? "all" : ceiling;
    const maxEmptyRounds = unbounded ? MAX_EMPTY_ROUNDS_ALL : MAX_EMPTY_ROUNDS;

    // `auto` picks per job: an unbounded sweep uses history, because that is
    // the only source that cannot go stale and so is the only way to promise
    // "everything, in one pass". Bounded runs prefer search, which is far
    // cheaper when you only want the most recent N.
    const mode = options.mode ?? "auto";
    let useHistory = mode === "history" || (mode === "auto" && unbounded);

    const searchKey = `search:${channelId}`;
    const deleteKey = `delete:${channelId}`;
    const fetchKey = `fetch:${channelId}`;
    const searchDelay = routeDelay("search");
    const deleteDelay = routeDelay("delete");
    const fetchDelay = routeDelay("fetch");

    let deletedCount = 0;
    let emptyRounds = 0;
    let before;                  // history pagination cursor
    let searchCursor;            // search pagination cursor (max_id)
    let lastBatchSize = 0;       // results in the last batch, before filtering
    let historyExhausted = false;
    // Messages we have already tried, so stale search results don't send us
    // back to the API for the same ID over and over.
    const attempted = new Set();

    const eta = (remaining) => {
        const seconds = Math.round((remaining * deleteDelay * limiter.factor) / 1000);
        return seconds > 90 ? `~${Math.round(seconds / 60)}m` : `~${seconds}s`;
    };

    /** Read the channel directly and keep only our own messages. */
    async function historyBatch() {
        const page = await limiter.schedule(
            fetchKey,
            () => channel.messages.fetch({ limit: HISTORY_PAGE_SIZE, ...(before ? { before } : {}) }),
            { minDelay: fetchDelay },
        );

        if (!page || page.size === 0) {
            historyExhausted = true;
            return [];
        }

        const messages = [...page.values()];
        lastBatchSize = messages.length;
        before = messages[messages.length - 1].id;
        if (messages.length < HISTORY_PAGE_SIZE) historyExhausted = true;

        return messages.filter((m) => m.author?.id === client.user.id);
    }

    /** Snowflake just below `id`, so the next page excludes `id` itself. */
    function stepBack(id) {
        try {
            return (BigInt(id) - 1n).toString();
        } catch {
            return id;
        }
    }

    /** Next batch of candidate messages, switching strategy if search dies. */
    async function nextBatch() {
        if (!useHistory) {
            try {
                const result = await limiter.schedule(
                    searchKey,
                    () => channel.messages.search({
                        limit: SEARCH_PAGE_SIZE,
                        authors: [client.user.id],
                        channels: [channelId],
                        // Page by snowflake, not by asking for "the newest 25"
                        // again each time. The index lags behind our deletes,
                        // so without a cursor it just re-serves messages we
                        // already deleted and we never reach the older ones.
                        ...(searchCursor ? { maxId: searchCursor } : {}),
                    }),
                    { minDelay: searchDelay },
                );

                if (!result?.messages) throw new TypeError("search returned no message list");

                const messages = [...result.messages.values()];
                lastBatchSize = messages.length;
                if (messages.length > 0) {
                    searchCursor = stepBack(messages[messages.length - 1].id);
                }
                return messages;
            } catch (error) {
                if (mode === "search") throw error;

                rateWarn(
                    `Search unavailable in ${where} (${describeSearchFailure(error)}). ` +
                    `Reading channel history instead.`
                );
                useHistory = true;
            }
        }

        return historyBatch();
    }

    // No banner for `all` - you typed it, you know what it does. The progress
    // counter below is the only thing worth showing.
    if (!unbounded) {
        rateInfo(
            `Deleting up to ${ceiling} message(s) in ${where} at ~${deleteDelay}ms each (${eta(ceiling)}).`
        );
    }
    process.stdout.write(`Deleting 0/${target}`);

    while (deletedCount < ceiling) {
        // In search mode we stop once the index keeps giving us nothing new.
        // In history mode we stop only at the start of the channel.
        if (!useHistory && emptyRounds >= maxEmptyRounds) break;

        let batch;
        try {
            batch = await nextBatch();
        } catch (error) {
            process.stdout.write("\n");
            rateWarn(`Could not list messages, stopping: ${error.message}`);
            break;
        }

        const deletable = batch.filter((m) => !m.system && !attempted.has(m.id));

        if (deletable.length === 0) {
            // An empty history page is normal - it just means none of the last
            // 100 messages were ours.
            if (useHistory) {
                if (historyExhausted) break;
                continue;
            }
            // In search mode, a page full of messages we have already tried is
            // stale index, not the end of the channel - the cursor moved, so
            // keep walking. Only a genuinely empty page means we are done.
            if (lastBatchSize === 0) emptyRounds++;
            continue;
        }

        let deletedThisRound = 0;
        let aborted = false;

        for (const message of deletable) {
            if (deletedCount >= ceiling) break;

            attempted.add(message.id);

            try {
                await limiter.schedule(deleteKey, () => message.delete(), {
                    minDelay: deleteDelay,
                });

                deletedCount++;
                deletedThisRound++;
                process.stdout.write(`\rDeleting ${deletedCount}/${target} `);
            } catch (error) {
                // Already gone - counts as done, not as a failure.
                if (isUnknownMessage(error)) continue;

                process.stdout.write("\n");
                rateWarn(`Failed to delete ${message.id}: ${error.message}`);

                // A permission or auth failure will repeat for every message
                // in this channel, so stop instead of burning the budget.
                if (error.code === 50001 || error.code === 50013 || error.httpStatus === 401) {
                    aborted = true;
                    break;
                }
            }
        }

        if (aborted) break;
        if (useHistory && historyExhausted) break;
        if (!useHistory) emptyRounds = deletedThisRound > 0 ? 0 : emptyRounds + 1;
    }

    process.stdout.write("\n");

    const stats = limiter.snapshot();
    commandInfo(
        unbounded
            ? `Deleted ${deletedCount} message(s) in ${where}`
            : `Deleted ${deletedCount}/${ceiling} messages in ${where}`
    );
    if (unbounded && deletedCount > 0 && !useHistory) {
        rateInfo(
            "That was a search-based sweep, which can miss messages the index has not caught up on. " +
            `Run \`dm all ${channelId} history\` to be certain nothing is left.`
        );
    }
    rateInfo(
        `${stats.requests} requests, ${stats.rateLimitHits} rate limit hit(s), ` +
        `${stats.retries} retr(ies), ${Math.round(stats.waitedMs / 1000)}s spent waiting.`
    );

    return deletedCount;
}


module.exports = {
    delete_message: delete_message,
    aliases: ["del", "dm"],
    description: "Delete your own messages in a channel.",
    usage: [
        ["dm", "delete your last 20 messages here"],
        ["dm 200", "delete your last 200 messages here"],
        ["dm 200 <channelId>", "delete 200 in another channel"],
        ["dm all", "delete every message of yours here"],
        ["dm all <channelId>", "delete every message of yours in another channel"],
        ["dm all <channelId> history", "force reading history instead of search"],
        ["dm 200 <channelId> search", "force search, no fallback"],
    ],
    notes: [
        "`all` reads channel history, which is exact - one pass clears everything.",
        "Bounded runs use search, which is cheaper, and fall back to history if it fails.",
        "Paced at ~1.1s per delete, so `all` on a busy channel runs for a long time. Ctrl-C stops it.",
        "Only ever touches your own messages.",
    ],
    /**
     * Usage:
     *   dm                  delete your last 20 messages here
     *   dm 200              delete your last 200 messages here
     *   dm 200 <channelId>  delete 200 in another channel
     *   dm all              delete every message of yours here
     *   dm all <channelId>  delete every message of yours in another channel
     *
     * `dm all` reads channel history, which is exact. Bounded runs use search,
     * which is cheaper. Override by adding `history` or `search` anywhere in
     * the command.
     *
     * @param {Message} ctx
     * @param {Client} client
     * @param {Array} args
     */
    async execute(client, ctx, ...args) {
        const positional = [];
        let mode = "auto";

        for (const arg of args) {
            const flag = String(arg).toLowerCase().replace(/^--/, "");
            if (flag === "history" || flag === "search") mode = flag;
            else positional.push(arg);
        }

        const max = parseCount(positional[0], DEFAULT_MAX);
        const channelId = positional[1] || ctx.channelId;

        await delete_message(client, ctx, max, channelId, { mode });
    }
}
