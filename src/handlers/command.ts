import {
    MessageFlags,
    type CacheType,
    type ChatInputCommandInteraction
} from "discord.js";

import type { DiscordClient } from "../client/DiscordClient.js";
import type { SlashCommandContext } from "../commands/BaseCommand.js";
import { interactionResponder, sendInteractionError } from "./responders.js";
import { checkCommandRateLimits } from "../utils/rateLimit.js";
import { formatTime } from "../utils/time.js";


export default async function handleSlashCommand(
    client: DiscordClient,
    interaction: ChatInputCommandInteraction<CacheType>
): Promise<void> {
    const { commandName, user } = interaction;
    const command = client.commands.get(commandName);
    let autoDeferTimer: NodeJS.Timeout | undefined;

    if (!command) {
        await interaction.reply({
            content: `Failed to find handler for ${commandName}`,
            flags: [MessageFlags.Ephemeral]
        });
        client.logger.warn(`[Command Handler] no handler for ${commandName}`);
        return;
    }

    if (command.options.ownerOnly && !client.isCommandOwner(user.id)) {
        await interaction.reply({
            content: "Owner only command",
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    if (command.options.guildOnly && !interaction.inGuild()) {
        await interaction.reply({
            content: "Guild only command",
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    try {
        const selectedSubcommand = interaction.options.getSubcommand(false);
        const executable = selectedSubcommand
            ? command.subcommands.get(selectedSubcommand)
            : command;
        const responder = interactionResponder(interaction);
        const commandContextBase = {
            ...responder,
            client,
            source: "slash",
            interaction,
            userId: user.id,
            guildId: interaction.guildId,
            commandName: command.data.name,
            ...(selectedSubcommand ? { subcommandName: selectedSubcommand } : {})
        } as const;
        const commandContext: SlashCommandContext<DiscordClient> = {
            ...commandContextBase,
            invalidSyntax: message => client.replyInvalidUsage(commandContextBase, message)
        };

        if (!executable) {
            const commandType = selectedSubcommand ? "subcommand" : "command";
            await interaction.reply({
                content: `Failed to find executable for the ${commandType} ${command.data.name}`,
                flags: [MessageFlags.Ephemeral]
            });
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
            userId: user.id,
            guildId: interaction.guildId,
            source: "slash",
            commandKey,
            ...(rateLimit !== undefined ? { rateLimit } : {})
        });

        if (rateLimitResult) {
            const remaining = formatTime(rateLimitResult.remainingMs, "ms");
            const message = rateLimitResult.type === "command"
                ? `You're using '${command.data.name}' too quickly. Try again in ${remaining}.`
                : `You're using commands too quickly. Try again in ${remaining}.`;
            await interaction.reply({
                content: message,
                flags: [MessageFlags.Ephemeral]
            });
            client.logger.debug(
                `${user.tag} hit the ${rateLimitResult.type} rate limit for ${commandKey}`
            );
            return;
        }

        const cooldown = executable.options.cooldown ?? command.options.cooldown;
        if (cooldown) {
            const result = client.sessions.checkCooldown({
                userId: user.id,
                guildId: interaction.guildId,
                duration: cooldown,
                key: `command:${commandKey}`
            });

            if (result.limited) {
                const remaining = formatTime(result.remainingMs, "ms");
                await interaction.reply({
                    content: `Please wait ${remaining} before using '${command.data.name}' again.`,
                    flags: [MessageFlags.Ephemeral]
                });
                client.logger.debug(
                    `${user.tag} needs to wait ${remaining} to run ${command.data.name}`
                );
                return;
            }
        }

        if (command.options.defer === true) {
            await interaction.deferReply(command.options.deferOptions);
        } else if (command.options.defer === "auto") {
            autoDeferTimer = setTimeout(() => {
                if (!interaction.replied && !interaction.deferred) {
                    void interaction.deferReply(command.options.deferOptions).catch(error => {
                        client.logger.error(
                            `[Slash Command Auto Defer] (${command.data.name})`,
                            error
                        );
                    });
                }
            }, 1_500);
        }

        await executable.execute(commandContext);
    } catch (error) {
        client.logger.error(`[Slash Command Handler] (${command.data.name})`, error);

        try {
            await sendInteractionError(interaction);
        } catch (responseError) {
            client.logger.error(
                `[Slash Command Error Response] (${command.data.name})`,
                responseError
            );
        }
    } finally {
        if (autoDeferTimer) clearTimeout(autoDeferTimer);
    }
}
