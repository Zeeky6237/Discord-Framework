import {
    EmbedBuilder,
    MessageFlags,
    type Message,
    type RepliableInteraction
} from "discord.js";
import type { CommandEmbedReply, CommandReply } from "../commands/BaseCommand.js";
import { errorEmbed, themedEmbed, withRequester } from "../theme/index.js";

export interface CommandResponder {
    reply(content: CommandReply): Promise<void>;
    embedReply(input: EmbedBuilder | CommandEmbedReply): Promise<void>;
}

export function interactionResponder(interaction: RepliableInteraction): CommandResponder {
    return {
        reply: content => replyToInteraction(interaction, content),
        embedReply: input => {
            const embed = prepareEmbed(
                input,
                interaction.user.displayName,
                interaction.user.displayAvatarURL({ size: 64 })
            );
            return replyToInteraction(interaction, embedPayload(input, embed));
        }
    };
}

export function messageResponder(message: Message): CommandResponder {
    return {
        reply: async content => {
            await message.reply(content);
        },
        embedReply: async input => {
            const embed = prepareEmbed(
                input,
                message.member?.displayName ?? message.author.displayName,
                message.author.displayAvatarURL({ size: 64 })
            );
            await message.reply(embedPayload(input, embed));
        }
    };
}

export async function sendInteractionError(
    interaction: RepliableInteraction,
    content = "Something went wrong while handling that interaction.",
    title = "Something went wrong"
): Promise<void> {
    const response = { embeds: [errorEmbed(title, content)] };
    if (interaction.deferred) {
        await interaction.editReply(response);
    } else if (interaction.replied) {
        await interaction.followUp({ ...response, flags: [MessageFlags.Ephemeral] });
    } else {
        await interaction.reply({ ...response, flags: [MessageFlags.Ephemeral] });
    }
}

async function replyToInteraction(
    interaction: RepliableInteraction,
    content: CommandReply
): Promise<void> {
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(content);
    } else {
        await interaction.reply(content);
    }
}

function prepareEmbed(
    input: EmbedBuilder | CommandEmbedReply,
    displayName: string,
    avatarURL: string
): EmbedBuilder {
    return withRequester(
        input instanceof EmbedBuilder ? input : themedEmbed(input),
        displayName,
        avatarURL
    );
}

function embedPayload(
    input: EmbedBuilder | CommandEmbedReply,
    embed: EmbedBuilder
): Exclude<CommandReply, string> {
    return {
        ...(input instanceof EmbedBuilder || !input.content ? {} : { content: input.content }),
        ...(input instanceof EmbedBuilder || !input.components ? {} : { components: input.components }),
        embeds: [embed]
    };
}
