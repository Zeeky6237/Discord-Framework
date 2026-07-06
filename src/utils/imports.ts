import { pathToFileURL } from "node:url";

// Cache-bustable dynamic imports used by framework loaders.

export interface ImportLogger {
    warn(message: string): void;
}

export async function importFile<T = unknown>(
    filePath: string,
    refresh = false
): Promise<{ default?: T }> {
    const url = pathToFileURL(filePath);
    if (refresh) url.searchParams.set("update", Date.now().toString());
    return import(url.href) as Promise<{ default?: T }>;
}

export async function importClassFile<T>(
    filePath: string,
    base?: abstract new (...args: never[]) => T,
    refresh = false,
    logger?: ImportLogger
): Promise<T | undefined> {
    const imported = await importFile<new () => T>(filePath, refresh);
    if (!imported.default) {
        logger?.warn(`Expected class import for file: ${filePath}`);
        return;
    }
    const instance = new imported.default();
    if (base && !(instance instanceof base)) {
        logger?.warn(`Got wrong class instance from ${filePath}`);
        return;
    }
    return instance;
}
