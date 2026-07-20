import path from "node:path";
import fs from "node:fs";

import { 
    REST, 
    Routes, 
    type RESTPostAPIChatInputApplicationCommandsJSONBody
} from "discord.js";

import { BaseCommand, BaseSubcommand } from "../commands/BaseCommand.js";
import { importClassFile } from "../utils/imports.js";
import type { LoaderLogger } from "./types.js";

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
