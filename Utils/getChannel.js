function getChannel(client, channelId) {
    return client.channels.cache.get(channelId) || client.channels.fetch(channelId);
}

module.exports.getChannel = getChannel;