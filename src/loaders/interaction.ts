import path from "node:path";
import fs from "node:fs";

import type { AnyInteractionRoute } from "../interactions/BaseInteraction.js";
import { importFile } from "../utils/imports.js";
import type { LoaderLogger } from "./types.js";

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
