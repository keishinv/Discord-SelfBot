/**
 * First-argument spellings that mean "no limit - keep going until there is
 * nothing left".
 */
const ALL_KEYWORDS = new Set(["all", "*", "max", "everything"]);

/**
 * Parse a user-supplied count argument.
 *
 * Returns Infinity for the "all" spellings, the parsed integer when it is a
 * usable number, and `fallback` for anything else - so a typo can never be
 * mistaken for "delete everything", and "all" can never be silently read as
 * the default.
 *
 * @param {string|undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function parseCount(value, fallback) {
    if (ALL_KEYWORDS.has(String(value ?? "").toLowerCase())) return Infinity;

    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = { parseCount, ALL_KEYWORDS };
