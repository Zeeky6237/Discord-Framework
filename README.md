# Discord Framework

Private shared Discord bot framework by Zeeky6237.

It owns the reusable command and event bases, themed reply responders, session
and rate-limit engine, timing helpers, and dynamic module imports. Individual
bots keep only their commands, integrations, configuration, and thin adapters
that bind framework generics to their concrete client type.

## Use from another local bot

```json
{
  "dependencies": {
    "@zeeky/discord-framework": "file:../discord-framework"
  },
  "scripts": {
    "build": "npm --prefix ../discord-framework run build && tsc"
  }
}
```

```ts
import {
    DiscordClient,
    BaseCommand as FrameworkCommand,
    type SlashCommandContext as FrameworkSlashContext
} from "@zeeky/discord-framework";

export class MyDiscordClient extends DiscordClient {
    constructor() {
        super({ intents: [...] });
        this.configureFrameworkModules({
            commands: {
                path: "/absolute/path/to/dist/commands",
                deployment: () => ({
                    token: this.config.token,
                    applicationId: this.config.clientId,
                    testGuilds: this.config.testGuilds
                })
            },
            eventsPath: "/absolute/path/to/dist/events",
            interactions: {
                path: "/absolute/path/to/dist/interactions",
                router: this.interactionRouter
            }
        });
    }
}

export abstract class BaseCommand extends FrameworkCommand<MyBotClient> {}
export type SlashCommandContext = FrameworkSlashContext<MyBotClient>;
```

`DiscordClient` creates the shared rotating logger automatically. Pass
`{ logger }` or `{ loggerOptions }` as its second constructor argument when a
bot needs custom behavior.

Configure branding once at startup with `configureTheme(...)`. Use
`interactionResponder(...)` and `messageResponder(...)` to provide identical
`reply` and `embedReply` behavior in every bot.

Use the shared rotating logger instead of keeping a copy in each bot:

```ts
import { Logger } from "@zeeky/discord-framework";

const logger = new Logger({
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
