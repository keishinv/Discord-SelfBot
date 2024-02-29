const { getChannel } = require("../Utils/getChannel.js");
const { Client, Message } = require("discord.js-selfbot-v13");
async function delete_message(client, ctx, max = 20, channelId = ctx.channelId) {
    channelId = (channelId), max = parseInt(max)

    const channel = getChannel(client, channelId);
    // console.log(channel);
    const messages = await channel.messages.fetch({ limit: max });
    // console.log(messages);

    // CHECK MSGTYPE CALL ETC
    // console.log("a");
    for (m of messages.values()) {
        // INITIAL MSG DELETE IN MSGCREATE IS PULLED THINKING IT HASNT BEEN DELETED
        // DiscordAPIError: Unknown Message
        // console.log(m);
        // console.log("---");
        // console.log(m.author.id == client.user.id);
        // m.delete();
        if (m) {
            m.delete();
        }
    }

}

module.exports = {
    aliases: ["del", "dm"],
    /**
     * @param {Message} ctx
     * @param {Client} client
     * @param {Array} args  
     */
    async execute(client, ctx, ...args) {
        // console.log(ctx);
        // console.log(args);
        // console.log(client);
        await delete_message(client, ctx, ...args);
    }
}


// Create a message collector
// const filter = m => m.author.id == client.user.id;
// const filter = m => m.content.includes('a');
// const collector = channel.createMessageCollector({ filter, time: 15_000 });
// collector.on('collect', m => console.log(`Collected ${m.content}`));
// collector.on('end', collected => console.log(`Collected ${collected.size} items`));