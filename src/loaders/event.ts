import fs from "node:fs";
import path from "node:path";
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
        const systemFile = fs.readdirSync(eventPath).find(file => file.endsWith("system.js"));
        if (!systemFile) continue;
        const imported = await importFile<BaseEvent<unknown, any, any>>(
            path.join(eventPath, systemFile),
            refresh
        );
        const handler = imported.default;
        if (!handler) continue;
        const listener = (...args: unknown[]) => handler.execute(client as never, args[0]);
        client.on(eventName, listener);
        client.events.set(eventName, { handler, listener });
        const stagesPath = path.join(eventPath, "stages");
        if (!fs.existsSync(stagesPath)) continue;
        for (const file of fs.readdirSync(stagesPath).filter(name => name.endsWith(".js"))) {
            const stage = await importFile<(event: BaseEvent<unknown, any, any>) => void>(
                path.join(stagesPath, file),
                refresh
            );
            stage.default?.(handler);
            client.logger.info(`│   └ Loaded event stage ${file.split(".")[0]}`);
        }
        client.logger.info(`├─ Loaded event ${eventName}`);
    }
}
