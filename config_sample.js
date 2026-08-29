require('dotenv').config();

/** Parse an env var as a number, falling back when unset or malformed. */
const num = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const config = {
    user: {
        token: process.env.USER_TOKEN,
        prefix: process.env.USER_PREFIX,
    },

    /**
     * Rate limiting. Every value is optional - omit the whole block and the
     * defaults in Utils/rateLimiter.js apply. Larger numbers are slower but
     * safer; lower them only if you are sure you are not being throttled
     * (watch for [RATELIMIT] warnings in the console).
     */
    rateLimit: {
        // Minimum ms between two requests in the same bucket.
        defaultDelay: num(process.env.RL_DEFAULT_DELAY, 750),
        // Random 0..jitter ms added to every gap.
        jitter: num(process.env.RL_JITTER, 250),
        // Retries per request before giving up.
        maxRetries: num(process.env.RL_MAX_RETRIES, 5),
        // Exponential backoff bounds for 5xx / network errors.
        baseBackoff: num(process.env.RL_BASE_BACKOFF, 1000),
        maxBackoff: num(process.env.RL_MAX_BACKOFF, 60000),
        // Safety margin added on top of any Retry-After Discord sends.
        timeOffset: num(process.env.RL_TIME_OFFSET, 750),
        // On a 429 every gap is multiplied by this, capped at maxFactor, then
        // relaxes back toward 1x after decayAfter ms without another 429.
        penaltyFactor: num(process.env.RL_PENALTY_FACTOR, 1.5),
        maxFactor: num(process.env.RL_MAX_FACTOR, 8),
        decayAfter: num(process.env.RL_DECAY_AFTER, 60000),

        // Per-route minimum spacing in ms. Message deletion sits in a much
        // stricter bucket than ordinary requests, so keep it high.
        routes: {
            delete: num(process.env.RL_DELETE_DELAY, 1100),
            search: num(process.env.RL_SEARCH_DELAY, 2500),
            reaction: num(process.env.RL_REACTION_DELAY, 800),
            send: num(process.env.RL_SEND_DELAY, 1200),
            edit: num(process.env.RL_EDIT_DELAY, 1100),
            fetch: num(process.env.RL_FETCH_DELAY, 750),
        },
    },

    /** Hard ceiling on outgoing REST requests per second, across all routes. */
    restGlobalRateLimit: num(process.env.RL_GLOBAL_RPS, 5),
};

module.exports = config;
