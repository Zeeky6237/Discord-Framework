# @zeeky6237/discord-framework

Reusable Discord bot framework.

It owns the reusable command and event bases, themed reply responders, session
and rate-limit engine, timing helpers, and dynamic module imports. Individual
bots keep only their commands, integrations, configuration, and thin adapters
that bind framework generics to their concrete client type.

## Install

```sh
npm install @zeeky6237/discord-framework discord.js
```

`discord.js` is a peer dependency, so each bot owns the exact Discord.js
version it runs with.

## Use from a bot

```json
{
  "dependencies": {
    "@zeeky6237/discord-framework": "^0.2.0",
    "discord.js": "^14.26.0"
  }
}
```

```ts
import {
    DiscordClient,
    BaseCommand as FrameworkCommand,
    type SlashCommandContext as FrameworkSlashContext
} from "@zeeky6237/discord-framework";

export class MyDiscordClient extends DiscordClient<MyDiscordClient> {
    constructor() {
        super({
            intents: [...],
            logger: {
                level: "debug",
                webhook: {
                    url: process.env.LOG_WEBHOOK_URL!,
                    level: "error",
                    username: "My Bot Logs"
                }
            },
            theme: {
                name: "My Bot",
                footer: "My Bot",
                iconURL: "https://example.com/icon.png",
                primary: 0x02ff6b,
                member: 0x075f2b,
                warning: 0xffc857,
                error: 0xff4d67,
                showRequester: false
            },
            commands: {
                deployment: client => ({
                    token: client.config.token,
                    applicationId: client.config.clientId,
                    developmentGuilds: client.config.developmentGuilds
                })
            }
        });
    }
}

export abstract class BaseCommand extends FrameworkCommand<MyDiscordClient> {}
export type SlashCommandContext = FrameworkSlashContext<MyDiscordClient>;
```

The self-type (`DiscordClient<MyDiscordClient>`) makes every framework
configuration callback infer `client` as `MyDiscordClient`. Without a self-type,
callbacks fall back to the base `DiscordClient` type.

The framework automatically detects `commands`, `events`, and `interactions`
next to the running bot entry file (for example, under `dist` or `scripts`). It
owns the standard command and interaction event pipelines internally; use
`createInteractionCustomId(...)` when building component IDs. `moduleRoot` and
individual `path` options remain available for non-standard build layouts.

All framework configuration is passed to `super(...)`; there is no separate
configuration call. Set `logger.level` to control the minimum local log
severity. `debug` shows everything; `info` also includes success and timer
messages; then `warn`, `error`, and `fatal` become progressively quieter.
`logger.webhook.level` is an independent threshold and defaults to `error`, so
debug and informational output can remain local without flooding Discord.
Webhook entries use embeds with coordinated colors for debug, info, success,
timer, warning, error, and fatal messages. Keep the webhook URL in an
environment variable rather than source control.

`DiscordClient` creates the shared rotating logger automatically. The `logger`
option accepts either built-in logger settings or a custom logger instance.

Set embed branding and colors with the `theme` client option. Use
`interactionResponder(...)` and `messageResponder(...)` to provide identical
`reply` and `embedReply` behavior in every bot. The theme is optional; omitted
colors use framework defaults, while omitted branding does not add an author,
branded footer, or icon to the embed. Empty branding values are also left off
instead of being sent to Discord.

Set `theme.showRequester` to `false` to disable automatic requester footers.
Individual embed replies can provide their own footer:

```ts
await ctx.embedReply({
    description: "Configuration saved.",
    footer: "Settings"
});
```

A footer supplied on an individual reply overrides the automatic requester
footer. Use `footer: ""` to omit the footer for only that reply.

Use the shared rotating logger instead of keeping a copy in each bot:

```ts
import { Logger } from "@zeeky6237/discord-framework";

const logger = new Logger({
    level: "info",
    writeToFile: true,
    logsDirectory: "./logs"
});
```

## Module lifecycle

The base client owns module lifecycle:

```ts
await client.loadFrameworkModules();
await client.reloadCommands();       // cache-busted command reload
await client.reloadCommands(true);   // reload and redeploy to Discord
await client.reloadEvents();         // removes old listeners first
await client.reloadInteractions();   // clears old routes first
```

Framework source is organized by responsibility under `src/client`,
`src/commands`, `src/events`, `src/interactions`, `src/loaders`,
`src/handlers`, `src/services`, `src/theme`, and `src/utils`.

## Command metadata and built-in help

Commands can describe both their slash and message forms. The framework's
command helper uses this metadata for help pages and can also be used by a
bot's invalid-syntax handler.

```ts
class PingCommand extends BaseCommand<MyBotClient> {
    data = new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Show the bot latency");

    options = {
        slash: true,
        chat: true,
        aliases: ["latency"],
        category: "General",
        permissionLevel: "everyone" as const,
        usage: {
            slash: ["/ping"],
            chat: ["{prefix}ping"],
            examples: { chat: ["{prefix}latency"] }
        }
    };
}
```

Enable and configure the framework-owned help command directly in the client
constructor. The framework deploys it and registers its pagination route
automatically:

```ts
super({
    intents: [...],
    commands: {
        prefix: client => client.config.prefix,
        isOwner: (client, userId) => client.config.ownerIds.has(userId),
        invalidUsageHelper: true,
        help: {
            design: {
                pageSize: 6,
                listTitle: (source, page, pages) =>
                    `${source === "slash" ? "Slash" : "Message"} command center · ${page + 1}/${pages}`,
                levelLabel: level => ({
                    everyone: "Community",
                    moderator: "Moderation",
                    administrator: "Administration",
                    owner: "Development"
                })[level],
                entry: entry => `**${entry.name}**\n${entry.description}`
            },
            show: (entry, { source }) =>
                source === "slash" || entry.command.options.chat === true
        },
        deployment: client => ({
            token: client.config.token,
            applicationId: client.config.clientId,
            developmentGuilds: client.config.developmentGuilds
        })
    }
});
```

Omit `help` or set `help: false` to disable the built-in command. Set
`invalidUsageHelper: false` to keep a basic invalid-command response without
displaying generated usage and example metadata.

Wire the second option into both slash and message command contexts:

```ts
const context = {
    ...responder,
    client,
    source: "slash" as const,
    commandName: command.data.name,
    // Include subcommandName when one was selected.
};

const commandContext = {
    ...context,
    invalidSyntax: message => client.replyInvalidUsage(context, message)
};
```

The exported command helpers are `commandAvailable`, `subcommandAvailable`,
`commandPermissionLevel`, `viewerPermissionLevel`, `canAccess`,
`permissionLabel`, `commandDisplayName`, `commandDescription`, `usageLines`,
and `exampleLines`. Hidden commands, disabled command surfaces, aliases,
subcommands, owner-only commands, and permission levels are handled by the
built-in help command.

## Local development

When testing changes from a sibling bot before publishing, use a local file
dependency:

```json
{
  "dependencies": {
    "@zeeky6237/discord-framework": "file:../discord-framework"
  },
  "scripts": {
    "build": "npm --prefix ../discord-framework run build && tsc"
  }
}
```
