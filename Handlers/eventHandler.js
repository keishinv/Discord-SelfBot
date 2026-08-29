const fs = require("fs");
const { eventsInfo, getLogger } = require("../Utils/logger");

async function eventHandler(client) {
    const files = fs.readdirSync("./Events").filter((file) => file.endsWith(".js"));

    for (const file of files) {
        const name = file.slice(0, -3);

        eventsInfo(`${name} Online.`);

        const event = require(`../Events/${file}`);

        // Catch rejections here: an unhandled one from a command (a 429 that
        // exhausted its retries, say) would otherwise take the process down.
        const run = async (...args) => {
            try {
                await event.execute(...args, client);
            } catch (error) {
                getLogger().error(`[EVENTS] ${name} failed: ${error.stack || error.message}`);
            }
        };

        if (event.once) {
            client.once(name, run);
        } else {
            client.on(name, run);
        }
    }
    return;
}

module.exports = { eventHandler };