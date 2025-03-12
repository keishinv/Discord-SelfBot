const fs = require("fs");
const { commandInfo } = require("../Utils/logger");

async function commandHandler(client) {
    const commands = fs.readdirSync("./Commands").filter(file => file.endsWith(".js"));

    for (file of commands) {
        const commandName = file.split(".")[0];
        const command = require(`../Commands/${file}`);

        client.commands.set(commandName, command);

        commandInfo(`${commandName} Loaded.`);

        command.aliases.forEach(alias => {
            client.aliases.set(alias, command);
        });
    }
}

module.exports = { commandHandler };
