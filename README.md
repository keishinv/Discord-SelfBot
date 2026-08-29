# Discord SelfBot

A small command-driven self-bot for your own Discord account. You type a
prefixed command in any channel, it runs, and the command message deletes
itself. Every API call is paced by a built-in rate limiter so the account
doesn't get throttled.

> **Heads up:** automating a user account is against Discord's Terms of
> Service. This is a personal tool for your own account and history; use it at
> your own risk, and keep the rate limits conservative.

---

## Requirements

- **Node.js 18 or newer** — check with `node -v`
- Your Discord account token (see [Getting your token](#getting-your-token))

Don't have Node? Install it with [Homebrew](https://brew.sh) (`brew install node`)
or grab the LTS installer from [nodejs.org](https://nodejs.org/en/download).

---

## Setup

Four steps. Run these from the project root.

### 1. Install dependencies

```bash
npm install
```

### 2. Create your config files

`config.js` and `.env` are gitignored, so a fresh clone won't have them. Copy
the samples:

```bash
cp config_sample.js config.js
cp .env_sample .env
```

### 3. Add your token

Open `.env` and fill in the two values:

```
USER_TOKEN="your_token_here"
USER_PREFIX="!"
```

`USER_PREFIX` is the character you type before a command — with `!`, the
delete command is `!dm 50`.

> **Never share or commit your token.** It is full access to your account, no
> password or 2FA needed. If it leaks, change your Discord password — that
> invalidates every existing token.

### 4. Run it

```bash
node index.js
```

or equivalently `npm start`. You should see:

```
[EVENTS] messageCreate Online.
[COMMANDS] delete_message Loaded.
[COMMANDS] remove_reactions Loaded.
[EVENTS] Name: yourname
[EVENTS] ID: 123456789012345678
[RATELIMIT] Pacing: 1100ms between deletes, 2500ms between searches, max 5 req/s globally.
```

Stop it with `Ctrl-C`.

---

## Getting your token

1. Open Discord in a browser, or the desktop app.
2. Press `Ctrl+Shift+I` (`Cmd+Option+I` on macOS) to open the developer console.
3. Paste this in and press Enter. It prints your token as the result.

```js
(w=webpackChunkdiscord_app).push([[Symbol()],{},o=>{try{Object.values(o.c).some(e=>e.exports?.setToken&&(w.t=e.exports.getToken()))}catch{}}]),w.t
```

Copy the printed string into `.env` as `USER_TOKEN`.

Two notes on this snippet:

- It prints the token on screen. If you're screen sharing or likely to
  screenshot the window, use `copy(w.t)` in place of the trailing `w.t` and it
  goes to the clipboard silently instead.
- It leaves the token in a global (`w.t`) for the rest of that page session.
  Reload the page when you're done to clear it.

> **Never paste console code you can't read.** "Paste this in your Discord
> console" is the single most common way accounts get stolen — a snippet that
> looks like this one but contains a `fetch(...)` sends your token to someone
> else, and a token is full account access with no password or 2FA needed. The
> snippet above is short enough to audit line by line: it only reads from
> Discord's own module cache and never touches the network. Hold anything
> longer, minified, or obfuscated to the same standard.

---

## Commands

Type these as normal messages in any channel. The command message is deleted
automatically after it runs.

| Command | Aliases | Purpose |
| --- | --- | --- |
| `delete_message <count\|all> [channelId] [history\|search]` | `del`, `dm` | Delete your own messages |
| `remove_reactions <count\|all\|messageId> [channelId]` | `rr`, `unreact` | Remove your own reactions |
| `help [command]` | `h`, `commands` | List commands, or show one in detail |
| `queue [clear\|cancel <id>]` | `q`, `jobs` | Show or manage the command queue |

Omit `channelId` to act on the channel you're typing in. Both commands accept
`all` in place of a count to run until there's nothing left — `*`, `max` and
`everything` work too. An unrecognised count falls back to the default rather
than being read as `all`, so a typo can't wipe a channel.

### delete_message

Searches for your messages in a channel and deletes them, oldest batch first,
until it hits the count or runs out.

| Command | Effect |
| --- | --- |
| `!dm` | delete your last 20 messages here |
| `!dm 200` | delete your last 200 messages here |
| `!dm 200 <channelId>` | delete 200 in another channel |
| `!dm all` | delete **every** message of yours here |
| `!dm all <channelId>` | delete every message of yours in another channel |
| `!dm all <channelId> history` | same, but read history instead of using search |

Deleting is paced at roughly one message per second, so 200 messages takes
about 4 minutes. That's deliberate — see [Rate limiting](#rate-limiting).

`all` runs until the channel has none of your messages left, so on a busy
channel it can run for hours. `Ctrl-C` stops it, and progress is never lost —
every message already deleted stays deleted, and re-running picks up where it
left off.

`all` reads channel history rather than using search, so one pass clears
everything — see [How it finds your messages](#how-it-finds-your-messages).

#### How it finds your messages

There are two ways, and the command picks automatically:

| Mode | How | Trade-off |
| --- | --- | --- |
| `search` | asks Discord for just your messages | Fast on busy channels, but depends on the guild search index |
| `history` | pages back through the channel, filters locally | Always works and is exact, but reads every message to find yours |

**`!dm all` uses history**, because the index lags behind your own deletions
and "everything" has to mean everything. **Bounded runs use search**, which is
far cheaper when you only want the most recent few — and if search is
unavailable (a freshly created ticket channel answers `202 Index not yet
available`), they say so and fall back to history on their own.

Search pages by message ID rather than re-asking for "the newest 25" each
round, so a stale index can't wedge it in place. Without that, deleting 25
messages leaves them in the index, the next search returns the same 25, and the
sweep stalls having never looked at anything older.

Force either mode by adding a word anywhere in the command:

```
!dm all <channelId> history
!dm all <channelId> search
```

`history` skips search entirely. `search` disables the fallback and fails
loudly instead, which is mostly useful for working out why a channel is
misbehaving.

`!rr` has no such split: it only ever reads history, which is why it works in
channels where `!dm` used to fail.

### remove_reactions

Scans recent messages and takes off any reaction you left, **including on
messages you didn't write**. Those can't be deleted, so this is the only way to
undo your mark on them. It uses the `reactions/:emoji/@me` route, which only
ever touches your own reaction and needs no permissions on the message.

| Command | Effect |
| --- | --- |
| `!rr` | scan the last 100 messages here |
| `!rr 500` | scan the last 500 messages here |
| `!rr 500 <channelId>` | scan the last 500 in another channel |
| `!rr all` | scan the whole channel |
| `!rr <messageId>` | just that one message, here |
| `!rr <messageId> <channelId>` | just that one message, elsewhere |

A numeric first argument is a scan count, `all` means the whole channel, and a
17–20 digit one is read as a message ID.

Messages with no reactions of yours cost no API calls, so a wide scan is mostly
cheap — the cost is one history fetch per 100 messages, plus one request per
reaction actually removed.

There's no reaction step inside `delete_message`, because deleting a message
takes its reactions with it.

### queue

Commands run **one at a time, in the order you typed them**. Type `!dm all X`
and then `!rr all X` and the second waits for the first, with a line telling
you it's queued and what it's behind.

Without that they run at once: they contend for the same rate limit buckets,
`!rr` scans messages `!dm` is about to delete, and both write progress to the
same terminal line with `\r`, so neither is readable.

| Command | Effect |
| --- | --- |
| `!queue` | what's running, what's waiting, how long each has been there |
| `!queue clear` | drop everything waiting |
| `!queue cancel <id>` | drop one waiting job by its `#id` |

```
  Command queue

  running  #1 dm all 1343814150291329056  for 4m 12s
        1  #2 rr all 1343814150291329056  waiting 3m 50s
```

`!queue` and `!help` skip the queue themselves, so they still answer while a
long sweep is running. Cancelling only affects **waiting** jobs — a job already
running is mid-request and can only be stopped with `Ctrl-C`.

The queue is global rather than per-channel, because the console is one shared
surface and one readable progress line at a time is the point.

### help

`!help` lists every loaded command with its aliases and description; `!help dm`
(or any alias) shows that command's full usage and notes.

It prints to **the console, not to Discord**. A user account can't send an
ephemeral reply, so posting help into a channel would put a wall of text in
front of everyone else in it — and spend a send request on something only you
need to read. It makes no API calls at all.

The listing is generated from the commands actually loaded at startup, so it
can't drift out of date. A new command shows up automatically; to give it a
good entry, export `description`, `usage` and `notes` alongside `aliases`:

```js
module.exports = {
    aliases: ["ex"],
    description: "One line, shown in the list.",
    usage: [
        ["ex", "what the bare command does"],
        ["ex <arg>", "what the argument changes"],
    ],
    notes: ["Anything worth knowing before running it."],
    async execute(client, ctx, ...args) { /* ... */ },
};
```

Commands are queued by default. Add `queued: false` if yours makes no API
calls and returns instantly, so it stays responsive during a long sweep.

---

## Rate limiting

All API calls go through `Utils/rateLimiter.js` so the account isn't throttled.
Four layers, outermost first:

1. **Proactive spacing** — calls are grouped into buckets (`delete:<channel>`,
   `reaction:<channel>`, `search:<channel>`). One request per bucket is in
   flight at a time, with a minimum gap plus jitter between them. Deletion is
   paced hardest, because Discord puts message deletes in their own much
   stricter bucket.
2. **Library ceiling** — `restGlobalRateLimit` caps total requests per second,
   and discord.js waits out any `Retry-After` it receives.
3. **Adaptive backoff** — every 429 (including ones absorbed by the library,
   caught via the client's `rateLimit` event) multiplies all gaps by
   `penaltyFactor`, up to `maxFactor`. A global 429 pauses every bucket. Gaps
   relax back toward normal after `decayAfter` ms without another 429.
4. **Retries** — 429s honour `Retry-After` plus a safety margin; 5xx and
   network errors retry with exponential backoff and jitter. Errors that can
   never succeed (Unknown Message, Unknown Emoji, Missing Permissions) fail
   fast instead of wasting requests.

Watch for `[RATELIMIT]` lines in the console. The occasional one is fine — the
limiter is doing its job. Frequent ones mean the delays are too low.

### Tuning

Every value is optional; see the `rateLimit` block in `config_sample.js` for
the full list. The ones that matter most, settable in `.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `RL_DELETE_DELAY` | `1100` | ms between message deletes |
| `RL_SEARCH_DELAY` | `2500` | ms between message searches |
| `RL_REACTION_DELAY` | `800` | ms between reaction removals |
| `RL_GLOBAL_RPS` | `5` | hard cap on requests/sec across all routes |
| `RL_MAX_RETRIES` | `5` | retries per request before giving up |
| `RL_TIME_OFFSET` | `750` | safety margin added to every wait |

Raising the delays is always safe. Lowering them is not — bulk deletion is the
easiest way to get an account flagged, so leave headroom.

---

## Troubleshooting

| What you see | What it means |
| --- | --- |
| `SyntaxError: invalid decimal literal` | You ran `python3 index.js`. This is JavaScript — use `node index.js`. |
| `zsh: command not found: index.js` | The interpreter has to come first: `node index.js`. |
| Prompt stuck at `if>` or `dquote>` | zsh swallowed a pasted `#` comment. Press `Ctrl-C` and paste commands without comments. |
| `zsh: command not found: node` | Node isn't installed — `brew install node`, or use the [nodejs.org](https://nodejs.org/en/download) installer. |
| `Cannot find module 'discord.js-selfbot-v13'` | Dependencies missing — run `npm install`. |
| `Cannot find module './config'` | Run `cp config_sample.js config.js`. |
| `Error [TOKEN_INVALID]` or an instant logout | `USER_TOKEN` in `.env` is empty or stale. Grab a fresh token. |
| Nothing happens when you type a command | Your message must start with `USER_PREFIX`, and commands only run on messages from your own account. |
| `!dm` finds nothing but `!rr` works in the same channel | Discord hasn't indexed that channel for search. The command falls back to reading history automatically; `!dm all <channelId> history` forces it. |
| `!dm all` stops early, leaving messages behind | Only happens if you forced `search`. The index lags behind your deletions. Re-run without the flag — `all` reads history by default and is exact. |
| Constant `[RATELIMIT]` warnings | Your delays are too aggressive. Raise `RL_DELETE_DELAY` / `RL_REACTION_DELAY`. |

---

## Project layout

```
index.js                     client setup, REST options, login
config.js                    your settings (gitignored)
.env                         your token and overrides (gitignored)
Commands/
  delete_message.js          delete your own messages
  remove_reactions.js        remove your own reactions
  help.js                    self-generating command reference
  queue.js                   inspect and manage the command queue
Events/
  messageCreate.js           command dispatch
Handlers/
  commandHandler.js          auto-loads Commands/
  eventHandler.js            auto-loads Events/
Utils/
  rateLimiter.js             request pacing, backoff, retries
  commandQueue.js            runs commands one at a time, in order
  parseCount.js              count arguments, including "all"
  logger.js                  timestamped colour console output
  getChannel.js              channel lookup
```

Adding a command: drop a file in `Commands/` exporting `aliases` and an
`async execute(client, ctx, ...args)`, plus `description`/`usage`/`notes` so it
reads well in `!help`. It's picked up on the next start. Route any API call
through the shared limiter:

```js
const { getLimiter, routeDelay } = require("../Utils/rateLimiter");

await getLimiter().schedule(`send:${channelId}`, () => channel.send("hi"), {
    minDelay: routeDelay("send"),
});
```
