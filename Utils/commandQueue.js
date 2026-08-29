"use strict";

const { queueInfo, queueWarn } = require("./logger");

/** "2m 13s" / "45s" */
function elapsed(since) {
    const seconds = Math.round((Date.now() - since) / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Runs commands one at a time, in the order they were typed.
 *
 * Without this, every message event starts its own command immediately, so
 * `dm all` and `rr all` run at once: they contend for the same rate limit
 * buckets, `rr` scans messages `dm` is about to delete, and both write
 * progress to the same terminal line with \r, so neither is readable.
 *
 * The queue is global rather than per-channel on purpose - the console is a
 * single shared surface, and one progress line at a time is the point.
 */
class CommandQueue {
    constructor() {
        /** @type {Array<object>} jobs waiting to start */
        this.waiting = [];
        /** @type {object|null} job currently running */
        this.current = null;
        this.nextId = 1;
        this.draining = false;
        this.completed = 0;
    }

    /**
     * Queue a command. Resolves with the command's return value, rejects with
     * whatever it threw, so callers can await it exactly as before.
     *
     * @param {string} label human-readable invocation, e.g. "dm all 1234"
     * @param {() => Promise<any>} fn
     */
    add(label, fn) {
        return new Promise((resolve, reject) => {
            const job = {
                id: this.nextId++,
                label,
                fn,
                resolve,
                reject,
                queuedAt: Date.now(),
                startedAt: null,
                cancelled: false,
            };

            this.waiting.push(job);

            if (this.current) {
                queueInfo(
                    `Queued #${job.id} ${label} - ${this.waiting.length} waiting, ` +
                    `${this.current.label} has been running ${elapsed(this.current.startedAt)}`
                );
            }

            this.drain();
        });
    }

    /** Pump the queue. Safe to call at any time; only one loop ever runs. */
    async drain() {
        if (this.draining) return;
        this.draining = true;

        try {
            while (this.waiting.length > 0) {
                const job = this.waiting.shift();

                if (job.cancelled) {
                    job.resolve(undefined);
                    continue;
                }

                this.current = job;
                job.startedAt = Date.now();

                if (this.waiting.length > 0) {
                    queueInfo(`Running #${job.id} ${job.label} (${this.waiting.length} still queued)`);
                }

                try {
                    job.resolve(await job.fn());
                } catch (error) {
                    job.reject(error);
                } finally {
                    this.completed++;
                    this.current = null;
                }
            }
        } finally {
            this.draining = false;
        }
    }

    /**
     * Drop a queued job by id. A job already running cannot be cancelled this
     * way - it has no way to be interrupted mid-request.
     *
     * @returns {object|null} the cancelled job, or null if it wasn't waiting
     */
    cancel(id) {
        const index = this.waiting.findIndex((job) => job.id === Number(id));
        if (index === -1) return null;

        const [job] = this.waiting.splice(index, 1);
        job.cancelled = true;
        job.resolve(undefined);
        queueWarn(`Cancelled #${job.id} ${job.label}`);
        return job;
    }

    /** Drop everything waiting. The running job is left alone. */
    clear() {
        const dropped = this.waiting.splice(0, this.waiting.length);
        for (const job of dropped) {
            job.cancelled = true;
            job.resolve(undefined);
        }
        if (dropped.length > 0) {
            queueWarn(`Cleared ${dropped.length} queued command(s).`);
        }
        return dropped;
    }

    snapshot() {
        return {
            running: this.current
                ? { id: this.current.id, label: this.current.label, for: elapsed(this.current.startedAt) }
                : null,
            waiting: this.waiting.map((job) => ({
                id: job.id,
                label: job.label,
                waiting: elapsed(job.queuedAt),
            })),
            completed: this.completed,
        };
    }
}

let singleton = null;

/** The one queue every command goes through. */
function getQueue() {
    if (!singleton) singleton = new CommandQueue();
    return singleton;
}

module.exports = { CommandQueue, getQueue, elapsed };
