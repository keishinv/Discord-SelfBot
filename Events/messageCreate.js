const { Client, Message } = require("discord.js-selfbot-v13");
const config = require('../config');
module.exports = {
    once: false,
    /**
     * @param {Client} client 
     * @param {Message} ctx 
     */
    async execute(ctx, client) {
        let content = ctx.content;

        const args = content.slice(config.user.prefix.length).trim().split(/ +/g);
        const commandName = args.shift().toLowerCase();
        let command;

        if (!(ctx.author.id == client.user.id)) return;

        // console.log(ctx);
        if (!content.toLowerCase().startsWith(config.user.prefix)) return;

        if (client.commands.has(commandName)) command = client.commands.get(commandName);
        else if (client.aliases.has(commandName)) command = client.aliases.get(commandName);

        ctx.delete();

        if (command) command.execute(client, ctx, ...args);
    }
}