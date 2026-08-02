import type { Message, OmitPartialGroupDMChannel } from "discord.js";

import type { DiscordClient } from "../client/DiscordClient.js";
import handleChatCommand from "../handlers/chatCommand.js";
import { Priority } from "../utils/Priority.js";
import { BaseEvent, type EventContext } from "./BaseEvent.js";


interface MessageCreateContext<TClient extends DiscordClient> extends EventContext<TClient> {
    message: OmitPartialGroupDMChannel<Message<boolean>>;
}

export class MessageCreateEvent<
    TClient extends DiscordClient
> extends BaseEvent<
    OmitPartialGroupDMChannel<Message<boolean>>,
    MessageCreateContext<TClient>,
    TClient
> {
    constructor() {
        super();

        this.use(async function command(ctx) {
            if (!ctx.message.content.startsWith(ctx.client.commandPrefix())) return;
            ctx.cancel();
            await handleChatCommand(ctx.client, ctx.message);
        }, Priority.NORMAL);
    }

    async execute(
        client: TClient,
        message: OmitPartialGroupDMChannel<Message<boolean>>
    ): Promise<void> {
        if (message.author.bot) return;
        const context = this.createContext({ message, client });
        await this.run(context);
    }
}
