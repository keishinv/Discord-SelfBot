const { commandInfo } = require("../Utils/logger");
const { getChannel } = require("../Utils/getChannel");
const { Client, Collection, Message, DiscordAPIError } = require("discord.js-selfbot-v13");
async function delete_message(client, ctx, max = 20, channelId = ctx.channelId) {
    let deletedCount = 0;
    let deletedLoop = 0;
    let offset = 0;

    const channel = getChannel(client, channelId);
    // DELETE REACTIONS
    // DELETED COUNT MSG NUMBER

    process.stdout.write(`Deleting ${deletedCount}/${max}`);

    while (deletedCount < max) {
        deletedLoop = 0;
        const messagesCollector = await channel.messages.search({
            limit: 25,
            authors: [client.user.id],
            channels: [channelId],
            // sortBy: 'timestamp',
            // sortOrder: 'asc',
            // minId: Date.now(),
        });

        const messages = messagesCollector.messages;

        const deletableMessages = messages.filter(m => !m.system);

        if (deletableMessages.size === 0) break; // Rare chance if all 25 msgs are system, mab near end- will terminate before all msgs
        // should compare last messages to new message if == break; not a big issue tbh

        for (const message of deletableMessages.values()) {
            try {
                await message.delete();

                deletedCount++;
                deletedLoop++;

                process.stdout.write(`\r Deleting ${deletedCount}/${max}`);

                if (deletedCount >= max) break;

            } catch (error) {
                if (!(error instanceof DiscordAPIError && error.message === 'Unknown Message')) {
                    console.error("Failed to delete message:", error);
                }
            }
        }
        offset += (messages.size - deletedLoop);
    }
    console.log();
    commandInfo(`Deleted ${deletedCount}/${max} messages in ${channelId}`)
    return;
}


module.exports = {
    delete_message: delete_message,
    aliases: ["del", "dm"],
    /**
     * @param {Message} ctx
     * @param {Client} client
     * @param {Array} args  
     */
    async execute(client, ctx, ...args) {
        const max = parseInt(args[0], 10) || 20;
        const channelId = args[1] || ctx.channelId;

        await delete_message(client, ctx, max, channelId);
    }
}

// Alternative | doesn't have filtering; maybe use around option? id
// https://discordjs.dev/docs/packages/discord.js/14.14.1/MessageManager:Class#fetch
// const messages = await channel.messages.fetch({ limit: max });

// for (m of messages.values()) {
//     try {
//         if (m.author.id == client.user.id && !(m.system)) {
//             m.delete();
//         }
//     } catch (error) {
//         if (error instanceof DiscordAPIError && error.message === 'Unknown Message') {
//             //   console.error('Tried to delete a message that does not exist');
//         } else {
//             console.log(m);
//             // throw error; // Re-throw the error if it's not the specific one we're looking for
//         }
//     }
// }

// Other option MessageCollector, seems to be broken in selfbot version
