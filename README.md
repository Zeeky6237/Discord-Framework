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

export class MyDiscordClient extends DiscordClient {
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
            commands: {
                deployment: client => ({
                    token: client.config.token,
                    applicationId: client.config.clientId,
                    testGuilds: client.config.testGuilds
                })
            }
        });
    }
}

export abstract class BaseCommand extends FrameworkCommand<MyBotClient> {}
export type SlashCommandContext = FrameworkSlashContext<MyBotClient>;
```

The framework automatically detects `commands`, `events`, and `interactions`
next to the running bot entry file (for example, under `dist` or `scripts`). If
the client exposes an `interactionRouter` property, that is detected too.
`moduleRoot` and individual `path` options remain available for non-standard
build layouts.

All framework configuration is passed to `super(...)`; there is no separate
configuration call. Set `logger.level` to control the minimum local log
severity. `debug` shows everything; `info` also includes success and timer
messages; then `warn`, `error`, and `fatal` become progressively quieter.
`logger.webhook.level` is an independent threshold and defaults to `error`, so
debug and informational output can remain local without flooding Discord. Keep
the webhook URL in an environment variable rather than source control.

`DiscordClient` creates the shared rotating logger automatically. The `logger`
option accepts either built-in logger settings or a custom logger instance.

Configure branding once at startup with `configureTheme(...)`. Use
`interactionResponder(...)` and `messageResponder(...)` to provide identical
`reply` and `embedReply` behavior in every bot.

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

The package includes a configurable help command factory. Put this in the
`index.ts` for the help command in your bot's normal commands directory:

```ts
import { ButtonStyle } from "discord.js";
import {
    createHelpCommand,
    type HelpCommandConfig
} from "@zeeky6237/discord-framework";
import type { MyBotClient } from "../../../client.js";

export const helpConfig: HelpCommandConfig<MyBotClient> = {
    prefix: client => client.config.prefix,
    isOwner: (client, userId) => client.config.ownerIds.has(userId),

    // These are independent. Both default to true.
    helpCommand: true,
    invalidUsageHelper: true,

    // Optional. Omit this and lists still work without page buttons.
    createPageCustomId: (client, source, page, userId) =>
        client.interactionRouter.createCustomId("help-page", source, page, userId),

    // Every part of the content and appearance can be replaced.
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
        entry: entry => `**${entry.name}**\n${entry.description}`,
        previousStyle: ButtonStyle.Secondary,
        nextStyle: ButtonStyle.Success,
        // Return an EmbedBuilder here for completely custom embed design.
        transform: embed => embed
    },

    // Optional per-user/per-surface visibility beyond permission metadata.
    show: (entry, { source }) =>
        source === "slash" || entry.command.options.chat === true
};

export default createHelpCommand(helpConfig);
```

Setting `helpCommand: false` prevents `/help` from being deployed and disables
its message-command form. Setting `invalidUsageHelper: false` keeps the basic
invalid-command response but stops it from reading and displaying usage and
example metadata.

Wire the second option into both slash and message command contexts:

```ts
import { createInvalidUsageHelper } from "@zeeky6237/discord-framework";

const context = {
    ...responder,
    client,
    source: "slash" as const,
    commandName: command.data.name,
    // Include subcommandName when one was selected.
};

const commandContext = {
    ...context,
    invalidSyntax: createInvalidUsageHelper(helpConfig, context)
};
```

If pagination is enabled, register the matching framework interaction route in
your interaction directory:

```ts
import { createHelpPageRoute } from "@zeeky6237/discord-framework";
import { helpConfig } from "../../commands/general/help/index.js";

export default createHelpPageRoute(helpConfig);
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
