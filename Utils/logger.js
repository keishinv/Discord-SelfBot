const winston = require('winston');
const chalk = require("chalk");

// Define colors for each log level.
const levelColors = {
    info: chalk.white,
    error: chalk.red,
    warn: chalk.yellow,
    debug: chalk.blue,
    critical: chalk.redBright,
};

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp }) => {
            // Get the appropriate color function for the current level
            const colorFn = levelColors[level] || ((text) => text);
            // Build the formatted message. This way the repeated text is centralized.
            return `${chalk.cyan(`[${timestamp}]`)} [${level.toUpperCase()}]: ${colorFn(message)}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
    ],
});

function getLogger() {
    return logger;
}

module.exports = {
    getLogger,
    commandInfo: (content) => getLogger().info(chalk.yellow("[COMMANDS] ") + content),
    eventsInfo: (content) => getLogger().info(chalk.yellow("[EVENTS] ") + content),
};
