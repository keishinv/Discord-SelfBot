function stringToBoolean(string) {
    switch (string.toLowerCase().trim()) {
        case 'true':
        case 'yes':
        case '1':
            return true;
        case 'false':
        case 'no':
        case '0':
        case null:
            return false;
        default:
            // Optionally, throw an error or return false by default
            return Boolean(string); // Converts non-empty strings to true, empty strings to false
    }
}

module.exports.stringToBoolean = stringToBoolean;