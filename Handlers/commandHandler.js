const fs = require("fs");
const { commandInfo } = require("../Utils/logger");

async function commandHandler(client) {
    const commands = fs.readdirSync("./Commands").filter(file => file.endsWith(".js"));
    // console.log(commands);
    for (file of commands) {
        const commandName = file.split(".")[0];
        const command = require(`../Commands/${file}`);
        client.commands.set(commandName, command);
        commandInfo(`${commandName} Online.`);

        // command.help.aliases.forEach(alias => {
        //     client.aliases.set(alias, command.help.name);
        // });
        // console.log(command.aliases);
        command.aliases.forEach(alias => {
            client.aliases.set(alias, command);
        });
        // console.log(client.aliases);
    }
}

module.exports = { commandHandler };