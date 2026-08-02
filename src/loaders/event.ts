import path from "node:path";
import fs from "node:fs";

import type { BaseEvent } from "../events/BaseEvent.js";
import { importFile } from "../utils/imports.js";
import type { LoaderLogger } from "./types.js";

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
        const existing = client.events.get(eventName);
        const systemFile = fs.readdirSync(eventPath).find(file => file.endsWith("system.js"));
        let handler = existing?.handler;
        if (!handler) {
            if (!systemFile) continue;
            const imported = await importFile<BaseEvent<unknown, any, any>>(
                path.join(eventPath, systemFile),
                refresh
            );
            const importedHandler = imported.default;
            if (!importedHandler) continue;
            handler = importedHandler;
            const listener = (...args: unknown[]) =>
                importedHandler.execute(client as never, args[0]);
            client.on(eventName, listener);
            client.events.set(eventName, { handler, listener });
        }
        const stagesPath = path.join(eventPath, "stages");
        if (fs.existsSync(stagesPath)) {
            for (const file of fs.readdirSync(stagesPath).filter(name => name.endsWith(".js"))) {
                const stage = await importFile<(event: BaseEvent<unknown, any, any>) => void>(
                    path.join(stagesPath, file),
                    refresh
                );
                stage.default?.(handler);
                client.logger.info(`│   └ Loaded event stage ${file.split(".")[0]}`);
            }
        }
        if (!existing) client.logger.info(`├─ Loaded event ${eventName}`);
    }
}
