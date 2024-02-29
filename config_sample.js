require('dotenv').config();

const config = {
    user: {
        token: process.env.USER_TOKEN,
        prefix: process.env.USER_PREFIX,
    },
};

module.exports = config;
