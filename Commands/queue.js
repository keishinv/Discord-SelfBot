const chalk = require("chalk");
const { getQueue } = require("../Utils/commandQueue");
const { Client, Message } = require("discord.js-selfbot-v13");

const INDENT = "  ";

/**
 * Inspect and manage the command queue.
 *
 * Never queued itself - waiting behind the job you are trying to look at
 * would defeat the point. Prints to the console like every other command.
 */
function render(queue, prefix) {
    const { running, waiting, completed } = queue.snapshot();
    const lines = ["", `${INDENT}${chalk.blue.bold("Command queue")}`, ""];

    if (!running && waiting.length === 0) {
        lines.push(`${INDENT}${chalk.gray("Nothing running, nothing queued.")}`);
        if (completed > 0) lines.push(`${INDENT}${chalk.gray(`${completed} command(s) done this session.`)}`);
        lines.push("");
        return lines;
    }

    if (running) {
        lines.push(`${INDENT}${chalk.green("running")}  ${chalk.cyan(`#${running.id}`)} ${running.label}  ${chalk.gray(`for ${running.for}`)}`);
    }

    for (const [index, job] of waiting.entries()) {
        lines.push(
            `${INDENT}${chalk.gray(String(index + 1).padStart(7))}  ` +
            `${chalk.cyan(`#${job.id}`)} ${job.label}  ${chalk.gray(`waiting ${job.waiting}`)}`
        );
    }

    lines.push(
        "",
        `${INDENT}${chalk.gray(`${prefix}queue clear      drop everything waiting`)}`,
        `${INDENT}${chalk.gray(`${prefix}queue cancel <#> drop one waiting job`)}`,
    );
    if (running) {
        lines.push(`${INDENT}${chalk.gray("The running job can only be stopped with Ctrl-C.")}`);
    }
    lines.push("");
    return lines;
}


module.exports = {
    aliases: ["q", "jobs"],
    queued: false,
    description: "Show or manage the command queue.",
    usage: [
        ["queue", "what is running and what is waiting"],
        ["queue clear", "drop every waiting command"],
        ["queue cancel <id>", "drop one waiting command by its #id"],
    ],
    notes: [
        "Commands run one at a time, in the order you typed them.",
        "Cancelling only affects waiting jobs - the running one needs Ctrl-C.",
        "This command and `help` skip the queue, so they answer during a long sweep.",
    ],
    /**
     * @param {Client} client
     * @param {Message} ctx
     * @param {Array} args
     */
    async execute(client, ctx, ...args) {
        const queue = getQueue();
        const config = require("../config");
        const prefix = config.user.prefix ?? "!";
        const action = String(args[0] ?? "").toLowerCase();

        if (action === "clear") {
            const dropped = queue.clear();
            if (dropped.length === 0) console.log(`\n${INDENT}${chalk.gray("Nothing was waiting.")}\n`);
            return;
        }

        if (action === "cancel") {
            const id = args[1];
            if (!id) {
                console.log(`\n${INDENT}${chalk.red(`Which one? ${prefix}queue cancel <id>`)}\n`);
                return;
            }
            if (!queue.cancel(id)) {
                console.log(`\n${INDENT}${chalk.red(`No waiting job #${id}.`)}\n`);
            }
            return;
        }

        console.log(render(queue, prefix).join("\n"));
    }
}
