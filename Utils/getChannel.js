function getChannel(client, channelId) {
    return client.channels.cache.get(channelId) || client.channels.resolve(channelId);
}

/**
 * Readable channel label for logs: "#general (1343814150291329056)".
 *
 * Keeps the id because that is what you paste back into a command; adds the
 * name because an id on its own tells you nothing about which channel you
 * just swept. Falls back to the bare id whenever there is no name to show -
 * an uncached channel, or one that simply has none.
 *
 * @param {object|null} channel
 * @param {string} [fallbackId] used when the channel could not be resolved
 */
function channelLabel(channel, fallbackId) {
    const id = channel?.id ?? fallbackId;
    if (!channel) return String(id);

    if (channel.name) {
        // Threads aren't top-level channels, so the # would be misleading.
        const isThread = typeof channel.isThread === "function" && channel.isThread();
        return `${isThread ? "" : "#"}${channel.name} (${id})`;
    }

    // DMs have no name, just the person on the other end.
    const recipient = channel.recipient?.username ?? channel.recipient?.tag;
    if (recipient) return `@${recipient} (${id})`;

    if (channel.recipients?.size) return `group DM (${id})`;

    return String(id);
}

module.exports = { getChannel, channelLabel };
module.exports.getChannel = getChannel;
