const { Client, Collection } = require("discord.js-selfbot-v13");
const config = require('./config');
const { eventHandler } = require("./Handlers/eventHandler");
const { commandHandler } = require("./Handlers/commandHandler");
const { eventsInfo } = require("./Utils/logger");

const client = new Client({
    checkUpdate: false
    // https://discordjs-self-v13.netlify.app/#/docs/docs/main/typedef/ClientOptions
});
client.commands = new Collection();
client.aliases = new Collection();

eventHandler(client);
commandHandler(client);

client.once('ready', () => {
    eventsInfo(`Name: ${client.user.username}`);
    eventsInfo(`ID: ${client.user.id}`);
});

client.login(config.user.token);