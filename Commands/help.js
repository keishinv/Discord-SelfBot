const chalk = require("chalk");
const config = require("../config");
const { getLimiter, routeDelay } = require("../Utils/rateLimiter");
const { Client, Message } = require("discord.js-selfbot-v13");

/**
 * Help prints to the console, not to Discord.
 *
 * A user account can't send an ephemeral reply, so posting help into a channel
 * would put a wall of text in front of everyone else in it - and cost a send
 * request against the rate limit for something only you need to read. Every
 * other command reports to the console too, so this keeps that consistent.
 *
 * Written with console.log rather than the winston logger on purpose: the
 * logger stamps every line with a timestamp and level, which turns a formatted
 * block into noise.
 */

const INDENT = "  ";

// Full ANSI escape, ESC byte included. Matching only the trailing
// "[33m" would leave the ESC behind and overcount by one per colour.
const ANSI = /\u001b\[[0-9;]*m/g;

/** Visible width, ignoring any colour codes. */
const width = (text) => String(text).replace(ANSI, "").length;
const pad = (text, to) => text + " ".repeat(Math.max(0, to - width(text)));

/** Every loaded command, de-duplicated and sorted, with `help` last. */
function listCommands(client) {
    return [...client.commands.entries()]
        .sort(([a], [b]) => (a === "help" ? 1 : b === "help" ? -1 : a.localeCompare(b)));
}

function resolve(client, name) {
    const key = String(name).toLowerCase();
    return client.commands.get(key) ?? client.aliases.get(key) ?? null;
}

/** Name a command module goes by, found by reverse lookup. */
function nameOf(client, command) {
    for (const [name, value] of client.commands.entries()) {
        if (value === command) return name;
    }
    return "?";
}

function overview(client, prefix) {
    const commands = listCommands(client);
    const nameWidth = Math.max(...commands.map(([name]) => width(name)));
    const aliasWidth = Math.max(
        ...commands.map(([, c]) => width((c.aliases ?? []).join(", "))),
    );

    const lines = [
        "",
        `${INDENT}${chalk.yellow.bold("Discord SelfBot")}   ${chalk.gray(`prefix ${prefix}`)}`,
        "",
    ];

    for (const [name, command] of commands) {
        const aliases = (command.aliases ?? []).join(", ");
        lines.push(
            INDENT +
            chalk.cyan(pad(name, nameWidth)) + "  " +
            chalk.gray(pad(aliases, aliasWidth)) + "  " +
            (command.description ?? chalk.gray("no description")),
        );
    }

    const limiter = getLimiter();
    lines.push(
        "",
        `${INDENT}${chalk.gray(`${prefix}help <command>  for usage and options`)}`,
        `${INDENT}${chalk.gray(
            `pacing  ${routeDelay("delete")}ms deletes | ${routeDelay("reaction")}ms reactions | ` +
            `${routeDelay("search")}ms searches | x${limiter.factor.toFixed(2)} current backoff`
        )}`,
        "",
    );

    return lines;
}

function detail(client, command, prefix) {
    const name = nameOf(client, command);
    const aliases = (command.aliases ?? []).join(", ");

    const lines = [
        "",
        `${INDENT}${chalk.cyan.bold(name)}${aliases ? chalk.gray(`   aliases: ${aliases}`) : ""}`,
    ];

    if (command.description) lines.push("", `${INDENT}${command.description}`);

    if (command.usage?.length) {
        const usageWidth = Math.max(...command.usage.map(([call]) => width(call)));
        lines.push("");
        for (const [call, what] of command.usage) {
            lines.push(
                INDENT + chalk.green(pad(prefix + call, usageWidth + prefix.length)) +
                "  " + chalk.gray(what),
            );
        }
    }

    if (command.notes?.length) {
        lines.push("", `${INDENT}${chalk.yellow("Notes")}`);
        for (const note of command.notes) lines.push(`${INDENT}- ${note}`);
    }

    lines.push("");
    return lines;
}


module.exports = {
    aliases: ["h", "commands"],
    queued: false,
    description: "Show this help.",
    usage: [
        ["help", "list every command"],
        ["help <command>", "usage and options for one command"],
    ],
    notes: [
        "Prints to the console, not to Discord - nobody else sees it.",
        "Makes no API calls, so it costs nothing against the rate limit.",
        "Skips the command queue, so it answers even during a long sweep.",
    ],
    /**
     * @param {Client} client
     * @param {Message} ctx
     * @param {Array} args
     */
    async execute(client, ctx, ...args) {
        const prefix = config.user.prefix ?? "!";
        const requested = args[0];

        if (!requested) {
            console.log(overview(client, prefix).join("\n"));
            return;
        }

        const command = resolve(client, requested);
        if (!command) {
            const known = listCommands(client)
                .map(([name]) => name)
                .join(", ");
            console.log(
                `\n${INDENT}${chalk.red(`No command "${requested}".`)}\n` +
                `${INDENT}${chalk.gray(`Try: ${known}`)}\n`
            );
            return;
        }

        console.log(detail(client, command, prefix).join("\n"));
    }
}
