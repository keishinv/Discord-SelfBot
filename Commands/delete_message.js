const { getChannel } = require("../Utils/getChannel.js");
const { commandInfo } = require("../Utils/logger");
const { Client, Message, DiscordAPIError } = require("discord.js-selfbot-v13");
async function delete_message(client, ctx, max = 20, channelId = ctx.channelId) {
    let deletedCount = 0;
    let deletedLoop = 0;
    let offset = 0;

    const channel = getChannel(client, channelId);
    // DELETE REACTIONS
    // SOME ISSUE WITH LONG DELETES DOESN'T LOG DELETED COUNT
    // DELETED COUNT MSG NUMBER
    while (deletedCount < max) {
        deletedLoop = 0;
        const messagesCollector = await channel.messages.search({
            // channel: [channel.id],
            channel: [channelId],
            // Maybe offset - 1
            offset: offset,
            minId: Date.now(),
        });

        const messages = messagesCollector.messages;
        
        if (messages.size === 0) break;

        const deletableMessages = messages.filter(m => m.author.id === client.user.id && !m.system);

        for (const message of deletableMessages.values()) {
            try {
                await message.delete();

                deletedCount++;
                deletedLoop++;
                if (deletedCount >= max) break;
            } catch (error) {
                if (!(error instanceof DiscordAPIError && error.message === 'Unknown Message')) {
                    console.error("Failed to delete message:", error);
                }
            }
        }

        // console.log(messages.size);
        offset+=(messages.size - deletedLoop);
        // console.log(offset);
    }
    commandInfo(`Deleted ${deletedCount} messages in ${ctx.channelId}`)
    return;
}

module.exports = {
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

// Alternative | doesn't have filtering
// const channel = getChannel(client, channelId);
// // const messages = await channel.messages.fetch({ limit: max });

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