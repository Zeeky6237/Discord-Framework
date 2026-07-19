import fs from "node:fs";
import path from "node:path";
import {
    REST,
    Routes,
    type RESTPostAPIChatInputApplicationCommandsJSONBody
} from "discord.js";
import { BaseCommand, BaseSubcommand } from "../commands/BaseCommand.js";
import type { BaseEvent } from "../events/BaseEvent.js";
import { importClassFile, importFile } from "../utils/imports.js";
import type { AnyInteractionRoute } from "../interactions/BaseInteraction.js";

export interface LoaderLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
}

export interface CommandLoaderClient<TClient> {
    commands: Map<string, BaseCommand<TClient>>;
    logger: LoaderLogger;
}

export interface CommandLoaderOptions<TClient> {
    client: TClient & CommandLoaderClient<TClient>;
    commandsPath: string;
    refresh?: boolean;
    deploy?: boolean;
    token: string;
    applicationId: string;
    testGuilds: Iterable<string>;
}

export async function loadCommands<TClient>(
    options: CommandLoaderOptions<TClient>
): Promise<void> {
    const {
        client,
        commandsPath,
        refresh = false,
        deploy = false
    } = options;
    const globalCommands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
    const ownerCommands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];

    for (const category of fs.readdirSync(commandsPath)) {
        const categoryPath = path.join(commandsPath, category);
        if (!fs.statSync(categoryPath).isDirectory()) continue;
        for (const commandFolder of fs.readdirSync(categoryPath)) {
            const commandPath = path.join(categoryPath, commandFolder);
            if (!fs.statSync(commandPath).isDirectory()) continue;
            const command = await importClassFile<BaseCommand<TClient>>(
                path.join(commandPath, "index.js"),
                BaseCommand,
                refresh,
                client.logger
            );
            if (!command) continue;
            const initialOptions = command.data.options.length;
            const subcommandsPath = path.join(commandPath, "subcommands");
            if (fs.existsSync(subcommandsPath)) {
                for (const file of fs.readdirSync(subcommandsPath).filter(name => name.endsWith(".js"))) {
                    const subcommand = await importClassFile<BaseSubcommand<TClient>>(
                        path.join(subcommandsPath, file),
                        BaseSubcommand,
                        refresh,
                        client.logger
                    );
                    if (!subcommand) continue;
                    if (!("addSubcommand" in command.data) || initialOptions > 0) {
                        client.logger.warn(
                            `Cannot add subcommand "${subcommand.data.name}" to "${command.data.name}".`
                        );
                        continue;
                    }
                    command.data.addSubcommand(subcommand.data);
                    command.subcommands.set(subcommand.data.name, subcommand);
                    client.logger.info(`│   └ Loaded subcommand /${command.data.name} ${subcommand.data.name}`);
                }
            }
            client.commands.set(command.data.name, command);
            if (command.options.slash !== false) {
                (command.options.ownerGuildsOnly ? ownerCommands : globalCommands)
                    .push(command.data.toJSON());
            }
            client.logger.info(`├─ Loaded command /${command.data.name}`);
        }
    }

    if ((!refresh && (globalCommands.length || ownerCommands.length)) || deploy) {
        const rest = new REST({ version: "10" }).setToken(options.token);
        await rest.put(
            Routes.applicationCommands(options.applicationId),
            { body: globalCommands }
        );
        for (const guildId of options.testGuilds) {
            await rest.put(
                Routes.applicationGuildCommands(options.applicationId, guildId),
                { body: ownerCommands }
            );
        }
        client.logger.info(`Deployed ${globalCommands.length + ownerCommands.length} commands.`);
    }
}

export interface EventLoaderClient {
    logger: LoaderLogger;
    events: Map<string, { handler: BaseEvent<unknown, any, any>; listener: (...args: any[]) => void }>;
    on(event: string, listener: (...args: any[]) => void): unknown;
}

export async function loadEvents(
    client: EventLoaderClient,
    eventsPath: string,
    refresh = false
): Promise<void> {
    for (const eventName of fs.readdirSync(eventsPath)) {
        const eventPath = path.join(eventsPath, eventName);
        if (!fs.statSync(eventPath).isDirectory()) continue;
        const systemFile = fs.readdirSync(eventPath).find(file => file.endsWith("system.js"));
        if (!systemFile) continue;
        const imported = await importFile<BaseEvent<unknown, any, any>>(
            path.join(eventPath, systemFile),
            refresh
        );
        const handler = imported.default;
        if (!handler) continue;
        const listener = (...args: unknown[]) => handler.execute(client as never, args[0]);
        client.on(eventName, listener);
        client.events.set(eventName, { handler, listener });
        const stagesPath = path.join(eventPath, "stages");
        if (!fs.existsSync(stagesPath)) continue;
        for (const file of fs.readdirSync(stagesPath).filter(name => name.endsWith(".js"))) {
            const stage = await importFile<(event: BaseEvent<unknown, any, any>) => void>(
                path.join(stagesPath, file),
                refresh
            );
            stage.default?.(handler);
            client.logger.info(`│   └ Loaded event stage ${file.split(".")[0]}`);
        }
        client.logger.info(`├─ Loaded event ${eventName}`);
    }
}

export interface InteractionLoaderClient<TClient> {
    logger: LoaderLogger;
    interactionRouter: {
        register(route: AnyInteractionRoute<TClient>): void;
    };
}

export async function loadInteractions<TClient>(
    client: InteractionLoaderClient<TClient>,
    interactionsPath: string,
    refresh = false
): Promise<void> {
    for (const file of findJavaScriptFiles(interactionsPath)) {
        const imported = await importFile<AnyInteractionRoute<TClient>>(file, refresh);
        const route = imported.default;
        if (!route || typeof route.execute !== "function") {
            client.logger.warn(`Invalid interaction route at ${file}`);
            continue;
        }
        client.interactionRouter.register(route);
        client.logger.info(`├─ Loaded interaction ${route.kind}:${route.route}`);
    }
}

function findJavaScriptFiles(directory: string): string[] {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory()
            ? findJavaScriptFiles(entryPath)
            : entry.name.endsWith(".js") ? [entryPath] : [];
    });
}
