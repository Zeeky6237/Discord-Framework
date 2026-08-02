import type { Message, OmitPartialGroupDMChannel } from "discord.js";

import type { DiscordClient } from "../client/DiscordClient.js";
import type { BaseCommand, ChatCommandContext } from "../commands/BaseCommand.js";
import { messageResponder } from "./responders.js";
import { checkCommandRateLimits } from "../utils/rateLimit.js";
import { formatTime } from "../utils/time.js";


export default async function handleChatCommand(
    client: DiscordClient,
    message: OmitPartialGroupDMChannel<Message<boolean>>
): Promise<void> {
    const prefix = client.commandPrefix();
    const parts = message.content.match(/"([^"]*)"|\S+/g) ?? [];
    const invokedName = parts[0]?.slice(prefix.length).toLowerCase();
    if (!invokedName) return;

    const command = findChatCommand(client.commands.values(), invokedName);
    if (!command) return;

    client.logger.debug(
        `${message.author.tag} issued chat command ${prefix}${invokedName}`,
        parts
    );

    if (!command.options.chat) {
        await message.reply({ content: "This is a slash only command" });
        return;
    }

    if (command.options.ownerOnly && !client.isCommandOwner(message.author.id)) {
        await message.reply({ content: "Owner only command" });
        return;
    }

    if (command.options.guildOnly && !message.inGuild()) {
        await message.reply({ content: "Guild only command" });
        return;
    }

    try {
        const args = parts.slice(1).map(part => part.replace(/(^"|"$)/g, ""));
        const commandContextBase = {
            ...messageResponder(message),
            client,
            source: "chat",
            args,
            message,
            userId: message.author.id,
            guildId: message.guildId,
            commandName: command.data.name
        } as const;
        const commandContext: ChatCommandContext<DiscordClient> = {
            ...commandContextBase,
            invalidSyntax: response => client.replyInvalidUsage(commandContextBase, response)
        };
        const maybeSubcommandName = args[0]?.toLowerCase();
        const selectedSubcommand = maybeSubcommandName
            && command.subcommands.has(maybeSubcommandName)
            ? maybeSubcommandName
            : undefined;
        const executable = selectedSubcommand
            ? command.subcommands.get(selectedSubcommand)
            : command;

        if (!executable) {
            const commandType = selectedSubcommand ? "subcommand" : "command";
            await message.reply(
                `Failed to find executable for the ${commandType} ${command.data.name}`
            );
            client.logger.warn(
                `Failed to find ${commandType} handler for ${command.data.name}`
            );
            return;
        }

        const commandKey = selectedSubcommand
            ? `${command.data.name}:${selectedSubcommand}`
            : command.data.name;
        const rateLimit = executable.options.rateLimit ?? command.options.rateLimit;
        const rateLimitResult = checkCommandRateLimits({
            sessions: client.sessions,
            userId: message.author.id,
            guildId: message.guildId,
            source: "chat",
            commandKey,
            ...(rateLimit !== undefined ? { rateLimit } : {})
        });

        if (rateLimitResult) {
            const remaining = formatTime(rateLimitResult.remainingMs, "ms");
            const response = rateLimitResult.type === "command"
                ? `You're using '${command.data.name}' too quickly. Try again in ${remaining}.`
                : `You're using commands too quickly. Try again in ${remaining}.`;
            await message.reply(response);
            client.logger.debug(
                `${message.author.tag} hit the ${rateLimitResult.type} rate limit for ${commandKey}`
            );
            return;
        }

        const cooldown = executable.options.cooldown ?? command.options.cooldown;
        if (cooldown) {
            const result = client.sessions.checkCooldown({
                userId: message.author.id,
                guildId: message.guildId,
                duration: cooldown,
                key: `command:${commandKey}`
            });

            if (result.limited) {
                const remaining = formatTime(result.remainingMs, "ms");
                await message.reply(
                    `Please wait ${remaining} before using '${command.data.name}' again.`
                );
                client.logger.debug(
                    `${message.author.tag} needs to wait ${remaining} to run ${command.data.name}`
                );
                return;
            }
        }

        await executable.execute(selectedSubcommand
            ? { ...commandContext, args: args.slice(1) }
            : commandContext
        );
    } catch (error) {
        client.logger.error(`[Chat Command Handler] (${command.data.name})`, error);

        try {
            await message.reply("Something went wrong while handling that command.");
        } catch (responseError) {
            client.logger.error(
                `[Chat Command Error Response] (${command.data.name})`,
                responseError
            );
        }
    }
}

function findChatCommand(
    commands: IterableIterator<BaseCommand<any>>,
    invokedName: string
): BaseCommand<any> | undefined {
    for (const command of commands) {
        if (command.data.name === invokedName) return command;
        if (command.options.chatName?.toLowerCase() === invokedName) return command;
        if (command.options.aliases?.some(alias => alias.toLowerCase() === invokedName)) {
            return command;
        }
    }
}
