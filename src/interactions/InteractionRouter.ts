import type {
    CacheType,
    Interaction,
    RepliableInteraction
} from "discord.js";

import type {
    AnyInteractionRoute,
    InteractionKindMap,
    InteractionRouteKind
} from "./BaseInteraction.js";
import {
    interactionResponder,
    sendInteractionError
} from "../handlers/responders.js";


const CUSTOM_ID_LIMIT = 100;
const INTERACTION_KINDS: ReadonlySet<string> = new Set([
    "button",
    "selectMenu",
    "modal",
    "autocomplete"
]);

interface InteractionRouterClient {
    logger: {
        warn(message: string, ...args: unknown[]): void;
        error(message: string, ...args: unknown[]): void;
    };
}

export class InteractionRouter<TClient extends InteractionRouterClient> {
    private readonly routes = new Map<
        InteractionRouteKind,
        Map<string, AnyInteractionRoute<TClient>>
    >();

    register(definition: AnyInteractionRoute<TClient>): void {
        if (!INTERACTION_KINDS.has(definition.kind)) {
            throw new TypeError(`Unsupported interaction kind "${definition.kind}"`);
        }

        this.validateRoute(definition.route);

        let kindRoutes = this.routes.get(definition.kind);
        if (!kindRoutes) {
            kindRoutes = new Map();
            this.routes.set(definition.kind, kindRoutes);
        }

        if (kindRoutes.has(definition.route)) {
            throw new Error(
                `Duplicate ${definition.kind} interaction route "${definition.route}"`
            );
        }

        kindRoutes.set(definition.route, definition);
    }

    clear(): void {
        this.routes.clear();
    }

    createCustomId(route: string, ...params: Array<string | number>): string {
        this.validateRoute(route);

        const customId = [
            route,
            ...params.map(param => encodeURIComponent(String(param)))
        ].join(":");

        if (customId.length > CUSTOM_ID_LIMIT) {
            throw new RangeError(
                `Interaction custom ID exceeds Discord's ${CUSTOM_ID_LIMIT} character limit`
            );
        }

        return customId;
    }

    async dispatch(
        client: TClient,
        interaction: Interaction<CacheType>
    ): Promise<boolean> {
        const resolved = this.resolve(interaction);
        if (!resolved) return false;

        const { kind, routedInteraction } = resolved;
        const match = this.findRoute(kind, resolved.routeValue);

        if (!match) {
            client.logger.warn(
                `[Interaction Router] No ${kind} route for "${resolved.routeValue}"`
            );
            await this.respondToUnknown(interaction);
            return true;
        }

        try {
            const params = kind === "autocomplete"
                ? []
                : this.decodeParams(resolved.routeValue, match.route);
            const responder = kind === "autocomplete"
                ? {}
                : interactionResponder(routedInteraction as RepliableInteraction);

            await match.definition.execute({
                client,
                interaction: routedInteraction,
                params,
                ...responder
            } as never);
        } catch (error) {
            client.logger.error(
                `[Interaction Router] (${kind}:${match.route})`,
                error
            );

            try {
                if (interaction.isAutocomplete()) {
                    if (!interaction.responded) await interaction.respond([]);
                } else if (interaction.isRepliable()) {
                    await sendInteractionError(interaction);
                }
            } catch (responseError) {
                client.logger.error(
                    `[Interaction Router Error Response] (${kind}:${match.route})`,
                    responseError
                );
            }
        }

        return true;
    }

    private resolve(interaction: Interaction<CacheType>): {
        kind: InteractionRouteKind;
        routeValue: string;
        routedInteraction: InteractionKindMap[InteractionRouteKind];
    } | undefined {
        if (interaction.isButton()) {
            return {
                kind: "button",
                routeValue: interaction.customId,
                routedInteraction: interaction
            };
        }

        if (interaction.isAnySelectMenu()) {
            return {
                kind: "selectMenu",
                routeValue: interaction.customId,
                routedInteraction: interaction
            };
        }

        if (interaction.isModalSubmit()) {
            return {
                kind: "modal",
                routeValue: interaction.customId,
                routedInteraction: interaction
            };
        }

        if (interaction.isAutocomplete()) {
            return {
                kind: "autocomplete",
                routeValue: interaction.commandName,
                routedInteraction: interaction
            };
        }
    }

    private findRoute(kind: InteractionRouteKind, value: string): {
        route: string;
        definition: AnyInteractionRoute<TClient>;
    } | undefined {
        const kindRoutes = this.routes.get(kind);
        if (!kindRoutes) return;

        let bestMatch: {
            route: string;
            definition: AnyInteractionRoute<TClient>;
        } | undefined;

        for (const [route, definition] of kindRoutes) {
            if (value !== route && !value.startsWith(`${route}:`)) continue;
            if (bestMatch && bestMatch.route.length >= route.length) continue;
            bestMatch = { route, definition };
        }

        return bestMatch;
    }

    private decodeParams(customId: string, route: string): string[] {
        if (customId === route) return [];

        return customId
            .slice(route.length + 1)
            .split(":")
            .map(param => decodeURIComponent(param));
    }

    private async respondToUnknown(
        interaction: Interaction<CacheType>
    ): Promise<void> {
        try {
            if (interaction.isAutocomplete()) {
                if (!interaction.responded) await interaction.respond([]);
                return;
            }

            if (interaction.isRepliable()) {
                await sendInteractionError(
                    interaction,
                    "This interaction is no longer available."
                );
            }
        } catch {
            // Unknown interactions may already have expired Discord tokens.
        }
    }

    private validateRoute(route: string): void {
        if (!route || route.startsWith(":") || route.endsWith(":")) {
            throw new TypeError(
                "Interaction routes must be non-empty and cannot start or end with ':'"
            );
        }
    }
}
