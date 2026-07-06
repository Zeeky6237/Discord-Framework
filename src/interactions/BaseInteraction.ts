import type {
    AnySelectMenuInteraction,
    AutocompleteInteraction,
    ButtonInteraction,
    EmbedBuilder,
    ModalSubmitInteraction
} from "discord.js";
import type { CommandEmbedReply, CommandReply } from "../commands/BaseCommand.js";

export interface InteractionKindMap {
    button: ButtonInteraction;
    selectMenu: AnySelectMenuInteraction;
    modal: ModalSubmitInteraction;
    autocomplete: AutocompleteInteraction;
}

export type InteractionRouteKind = keyof InteractionKindMap;

interface BaseInteractionRouteContext<
    TClient,
    TKind extends InteractionRouteKind
> {
    client: TClient;
    interaction: InteractionKindMap[TKind];
    params: string[];
}

export type InteractionRouteContext<
    TClient,
    TKind extends InteractionRouteKind
> = BaseInteractionRouteContext<TClient, TKind>
    & (TKind extends "autocomplete" ? {} : {
        reply(content: CommandReply): Promise<void>;
        embedReply(embed: EmbedBuilder | CommandEmbedReply): Promise<void>;
    });

export interface InteractionRoute<
    TClient,
    TKind extends InteractionRouteKind
> {
    kind: TKind;
    route: string;
    execute(ctx: InteractionRouteContext<TClient, TKind>): void | Promise<void>;
}

export type AnyInteractionRoute<TClient> = {
    [TKind in InteractionRouteKind]: InteractionRoute<TClient, TKind>
}[InteractionRouteKind];

export function defineInteractionRoute<
    TClient,
    TKind extends InteractionRouteKind
>(route: InteractionRoute<TClient, TKind>): InteractionRoute<TClient, TKind> {
    return route;
}
