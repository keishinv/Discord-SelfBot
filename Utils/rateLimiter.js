"use strict";

const { rateWarn, rateInfo } = require("./logger");

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * Discord error codes that will never succeed on retry. Retrying these just
 * burns requests against the bucket, which is what gets you throttled.
 */
const FATAL_API_CODES = new Set([
    10003, // Unknown Channel
    10004, // Unknown Guild
    10008, // Unknown Message
    50001, // Missing Access
    50013, // Missing Permissions
    10014, // Unknown Emoji
    50021, // Cannot execute action on a system message
    50083, // Thread is archived
]);

const RETRYABLE_NETWORK_CODES = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EPIPE",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
]);

const DEFAULTS = {
    // Minimum gap between two calls in the same bucket, in ms.
    defaultDelay: 750,
    // Extra random 0..jitter ms added to every gap so parallel buckets don't
    // line up and fire in lockstep.
    jitter: 250,
    // How many times a single request may be retried before giving up.
    maxRetries: 5,
    // Exponential backoff for 5xx / network failures.
    baseBackoff: 1000,
    maxBackoff: 60000,
    // Safety margin added on top of any Retry-After we are told to wait.
    timeOffset: 750,
    // When a 429 lands, every bucket's gap is multiplied by this, up to
    // maxFactor. It relaxes back toward 1 after decayAfter ms without a 429.
    penaltyFactor: 1.5,
    maxFactor: 8,
    decayAfter: 60000,
};

/**
 * Classify a thrown error into how it should be handled.
 * @returns {{type: 'ratelimit'|'retry'|'fatal', retryAfter?: number, global?: boolean}}
 */
function classify(error) {
    if (!error) return { type: "fatal" };

    const status = error.httpStatus ?? error.status ?? error.statusCode;

    // discord.js throws RateLimitError only when rejectOnRateLimit matches;
    // otherwise it waits internally. Handle both shapes.
    const isRateLimit =
        status === 429 ||
        error.name === "RateLimitError" ||
        typeof error.timeout === "number";

    if (isRateLimit) {
        const retryAfter =
            error.timeout ??
            (typeof error.retryAfter === "number" ? error.retryAfter * 1000 : null) ??
            5000;
        return { type: "ratelimit", retryAfter, global: Boolean(error.global) };
    }

    if (typeof error.code === "number" && FATAL_API_CODES.has(error.code)) {
        return { type: "fatal" };
    }

    if (typeof error.code === "string" && RETRYABLE_NETWORK_CODES.has(error.code)) {
        return { type: "retry" };
    }

    if (error.name === "AbortError" || error.name === "FetchError") {
        return { type: "retry" };
    }

    if (typeof status === "number" && status >= 500) return { type: "retry" };

    // 4xx that isn't a rate limit means the request itself is wrong.
    if (typeof status === "number" && status >= 400) return { type: "fatal" };

    return { type: "fatal" };
}

/** True for "the message is already gone", which is a success for our purposes. */
function isUnknownMessage(error) {
    return error?.code === 10008 || error?.message === "Unknown Message";
}

class RateLimiter {
    constructor(options = {}) {
        this.options = { ...DEFAULTS, ...options };

        /** @type {Map<string, {last:number, minDelay:number, tail:Promise<void>}>} */
        this.buckets = new Map();

        // Timestamp before which nothing may be sent, on any bucket.
        this.globalResumeAt = 0;

        // Multiplier applied to every bucket gap; grows on 429, decays with time.
        this.factor = 1;
        this.lastPenaltyAt = 0;

        this.stats = {
            requests: 0,
            retries: 0,
            rateLimitHits: 0,
            waitedMs: 0,
        };
    }

    bucket(key, minDelay) {
        let bucket = this.buckets.get(key);
        if (!bucket) {
            bucket = {
                last: 0,
                minDelay: minDelay ?? this.options.defaultDelay,
                tail: Promise.resolve(),
            };
            this.buckets.set(key, bucket);
        } else if (typeof minDelay === "number") {
            bucket.minDelay = minDelay;
        }
        return bucket;
    }

    /** Current gap for a bucket, including the adaptive penalty and jitter. */
    gap(bucket) {
        this.decay();
        return bucket.minDelay * this.factor + Math.random() * this.options.jitter;
    }

    /** Relax the penalty multiplier once we've gone a while without a 429. */
    decay() {
        if (this.factor <= 1) return;
        if (Date.now() - this.lastPenaltyAt < this.options.decayAfter) return;
        this.factor = Math.max(1, this.factor / this.options.penaltyFactor);
        this.lastPenaltyAt = Date.now();
        if (this.factor > 1) {
            rateInfo(`Easing off: request spacing now x${this.factor.toFixed(2)}`);
        } else {
            rateInfo("Back to normal request spacing.");
        }
    }

    /** Record that we were throttled and slow everything down. */
    penalize() {
        this.stats.rateLimitHits++;
        this.factor = Math.min(this.options.maxFactor, this.factor * this.options.penaltyFactor);
        this.lastPenaltyAt = Date.now();
    }

    /** Block every bucket for `ms` (used for global 429s). */
    pauseGlobal(ms) {
        const until = Date.now() + ms;
        if (until > this.globalResumeAt) this.globalResumeAt = until;
    }

    /** Wait until both the global gate and this bucket's spacing allow a send. */
    async gate(bucket) {
        // Loop, because a 429 on another bucket can push globalResumeAt out
        // while we are already sleeping.
        for (;;) {
            const now = Date.now();
            const wait = Math.max(this.globalResumeAt - now, bucket.last + this.gap(bucket) - now, 0);
            if (wait <= 0) return;
            this.stats.waitedMs += wait;
            await sleep(wait);
        }
    }

    /**
     * Run `fn` under the bucket's rate limit, retrying on 429 / 5xx / network
     * errors. Calls sharing a key are serialized, so ordering is preserved.
     *
     * @param {string} key      bucket name, e.g. `delete:${channelId}`
     * @param {() => Promise<any>} fn
     * @param {{minDelay?: number, maxRetries?: number}} [opts]
     */
    async schedule(key, fn, opts = {}) {
        const bucket = this.bucket(key, opts.minDelay);

        // Chain onto the bucket's tail so only one request per bucket is
        // in flight at a time.
        const previous = bucket.tail;
        let release;
        bucket.tail = new Promise((resolve) => {
            release = resolve;
        });

        await previous;

        try {
            return await this.execute(key, fn, bucket, opts);
        } finally {
            bucket.last = Date.now();
            release();
        }
    }

    async execute(key, fn, bucket, opts) {
        const maxRetries = opts.maxRetries ?? this.options.maxRetries;
        let attempt = 0;

        for (;;) {
            await this.gate(bucket);
            bucket.last = Date.now();

            try {
                this.stats.requests++;
                return await fn();
            } catch (error) {
                const verdict = classify(error);

                if (verdict.type === "fatal" || attempt >= maxRetries) throw error;

                attempt++;
                this.stats.retries++;

                let wait;
                if (verdict.type === "ratelimit") {
                    wait = verdict.retryAfter + this.options.timeOffset;
                    this.penalize();
                    if (verdict.global) this.pauseGlobal(wait);
                    rateWarn(
                        `429 on ${key} - waiting ${Math.round(wait)}ms ` +
                        `(${verdict.global ? "global" : "bucket"}, retry ${attempt}/${maxRetries})`,
                    );
                } else {
                    wait =
                        Math.min(this.options.baseBackoff * 2 ** (attempt - 1), this.options.maxBackoff) +
                        Math.random() * this.options.jitter;
                    rateWarn(
                        `${error.name || "Error"} on ${key} - backing off ${Math.round(wait)}ms ` +
                        `(retry ${attempt}/${maxRetries})`,
                    );
                }

                this.stats.waitedMs += wait;
                await sleep(wait);
            }
        }
    }

    snapshot() {
        return {
            ...this.stats,
            factor: Number(this.factor.toFixed(2)),
            buckets: this.buckets.size,
        };
    }
}

/**
 * Listen to the library's own rate limit reporting so that a 429 absorbed
 * internally by discord.js still slows our own scheduler down.
 */
function attachRateLimitMonitor(client, limiter) {
    client.on("rateLimit", (info) => {
        const timeout = info?.timeout ?? 0;
        limiter.penalize();
        if (info?.global) limiter.pauseGlobal(timeout + limiter.options.timeOffset);

        rateWarn(
            `Throttled by Discord: ${info?.method ?? "?"} ${info?.route ?? info?.path ?? "?"} ` +
            `- limit ${info?.limit ?? "?"}, waiting ${timeout}ms` +
            `${info?.global ? " (GLOBAL)" : ""}`,
        );
    });

    return limiter;
}

/**
 * Per-route minimum spacing, in ms. Discord does not publish user-account
 * limits, so these are deliberately conservative: message deletion in
 * particular sits in its own much stricter bucket than normal requests.
 */
const ROUTE_DELAYS = {
    delete: 1100,   // DELETE /channels/:id/messages/:id
    search: 2500,   // GET    /guilds/:id/messages/search
    reaction: 800,  // DELETE /channels/:id/messages/:id/reactions/:emoji/@me
    send: 1200,     // POST   /channels/:id/messages
    edit: 1100,
    fetch: 750,     // GET    /channels/:id/messages
};

/** Read config.rateLimit without exploding if config.js predates this feature. */
function loadOptions() {
    let configured = {};
    try {
        configured = require("../config").rateLimit || {};
    } catch {
        configured = {};
    }
    const { routes: configuredRoutes = {}, ...rest } = configured;
    return {
        options: { ...DEFAULTS, ...rest },
        routes: { ...ROUTE_DELAYS, ...configuredRoutes },
    };
}

let singleton = null;

/**
 * Shared limiter for the whole process. Commands should use this rather than
 * constructing their own, otherwise each command gets its own budget and the
 * account gets throttled anyway.
 */
function getLimiter() {
    if (!singleton) {
        const { options, routes } = loadOptions();
        singleton = new RateLimiter(options);
        singleton.routes = routes;
    }
    return singleton;
}

/** Minimum spacing for a named route, falling back to the default gap. */
function routeDelay(name) {
    const limiter = getLimiter();
    return limiter.routes[name] ?? limiter.options.defaultDelay;
}

module.exports = {
    RateLimiter,
    attachRateLimitMonitor,
    getLimiter,
    routeDelay,
    isUnknownMessage,
    classify,
    sleep,
    DEFAULTS,
    ROUTE_DELAYS,
};
