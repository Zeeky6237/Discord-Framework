import {
    ApplicationCommandOptionType,
    InteractionType,
    type CacheType,
    type Interaction
} from "discord.js";

import type { DiscordClient } from "../client/DiscordClient.js";
import handleSlashCommand from "../handlers/command.js";
import { Priority } from "../utils/Priority.js";
import { BaseEvent, type EventContext } from "./BaseEvent.js";


interface InteractionCreateContext<TClient extends DiscordClient> extends EventContext<TClient> {
    interaction: Interaction<CacheType>;
}

export class InteractionCreateEvent<
    TClient extends DiscordClient
> extends BaseEvent<Interaction<CacheType>, InteractionCreateContext<TClient>, TClient> {
    constructor() {
        super();

        this.use(async function interaction(ctx) {
            const handled = await ctx.client.dispatchInteraction(ctx.interaction);
            if (handled) ctx.cancel();
        }, Priority.NORMAL);

        this.use(async function command(ctx) {
            const { interaction } = ctx;
            if (!interaction.isChatInputCommand()) return;
            ctx.cancel();

            ctx.client.logger.debug(
                `${interaction.user.tag} issued command /${interaction.commandName}`,
                interaction.options.data.map(option => ({
                    type: ApplicationCommandOptionType[option.type],
                    name: option.name,
                    value: option.value
                }))
            );

            await handleSlashCommand(ctx.client, interaction);
        }, Priority.NORMAL);
    }

    async execute(
        client: TClient,
        interaction: Interaction<CacheType>
    ): Promise<void> {
        const context = this.createContext({ interaction, client });
        await this.run(context);

        if (!context.cancelled) {
            client.logger.debug(
                `${interaction.user.tag} issued interaction ${InteractionType[interaction.type]}`
            );
        }
    }
}
