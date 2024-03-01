function getChannel(client, channelId) {
    return client.channels.cache.get(channelId) || client.channels.resolve(channelId);

}

module.exports.getChannel = getChannel;