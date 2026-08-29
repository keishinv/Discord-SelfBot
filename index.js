const { Client, Collection } = require("discord.js-selfbot-v13");
const config = require('./config');
const { eventHandler } = require("./Handlers/eventHandler");
const { commandHandler } = require("./Handlers/commandHandler");
const { eventsInfo, rateInfo } = require("./Utils/logger");
const { getLimiter, attachRateLimitMonitor } = require("./Utils/rateLimiter");
const { delete_message } = require("./Commands/delete_message");

const client = new Client({
    checkUpdate: false,

    // --- Rate limit safety net -------------------------------------------
    // Our own limiter (Utils/rateLimiter.js) paces requests so we should not
    // reach these, but they bound the damage if a code path slips past it.
    // https://discordjs-self-v13.netlify.app/#/docs/docs/main/typedef/ClientOptions

    // Hard ceiling on REST requests per second across every route. 0 = off.
    restGlobalRateLimit: config.restGlobalRateLimit ?? 5,
    // Extra ms added to every rate limit wait, to absorb clock skew between
    // us and Discord. Without headroom you resume a hair too early and 429.
    restTimeOffset: config.rateLimit?.timeOffset ?? 750,
    // Retries for 5xx / network failures inside the library itself.
    retryLimit: 3,
    // Give a slow request longer before aborting, so a stall is not retried
    // into a second request while the first is still open.
    restRequestTimeout: 30_000,
    // Drop stale per-route handlers so the bucket map does not grow forever.
    restSweepInterval: 60,
});

client.commands = new Collection();
client.aliases = new Collection();

// Shared limiter, so every command draws from one budget instead of each
// keeping its own and collectively blowing past the real limit.
client.limiter = getLimiter();
attachRateLimitMonitor(client, client.limiter);

eventHandler(client);
commandHandler(client);

client.once('ready', () => {
    eventsInfo(`Name: ${client.user.username}`);
    eventsInfo(`ID: ${client.user.id}`);
    rateInfo(
        `Pacing: ${client.limiter.routes.delete}ms between deletes, ` +
        `${client.limiter.routes.search}ms between searches, ` +
        `max ${client.options.restGlobalRateLimit || "unlimited"} req/s globally.`
    );
    // delete_message(client, { channelId: 0 }, 100000, "1210737333217927188");
});

client.login(config.user.token);
