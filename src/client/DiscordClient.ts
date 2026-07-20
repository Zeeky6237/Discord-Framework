import {
    Client as DiscordJsClient,
    Collection,
    type ClientOptions
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import type { BaseCommand } from "../commands/BaseCommand.js";
import type { BaseEvent } from "../events/BaseEvent.js";
import {
    Logger,
    type LogColor,
    type LogContent,
    type LoggerOptions,
    type LogLevel
} from "../logging/Logger.js";
import { SessionManager } from "../services/SessionManager.js";
import {
    loadCommands as loadCommandModules,
    loadEvents as loadEventModules,
    loadInteractions as loadInteractionModules
} from "../loaders/index.js";

export interface ClientLogger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
    fatal(message: string, ...args: unknown[]): void;
    success(message: string, ...args: unknown[]): void;
    time(): this;
    end(message: string, silent?: boolean): void;
    writeLog(level: LogLevel, message: string, ...args: unknown[]): void;
    chalkLog(content: LogContent & { message: LogColor }, level: LogLevel): void;
    close?(): void;
}

export interface FrameworkClientOptions {
    logger?: ClientLogger;
    loggerOptions?: LoggerOptions;
}

export interface ClientInteractionRouter {
    clear(): void;
    register(route: any): void;
}

export interface CommandDeployment {
    token: string;
    applicationId: string;
    testGuilds: Iterable<string>;
}

export interface FrameworkModuleConfig {
    /**
     * Runtime directory containing commands, events, and interactions.
     * Normally omitted because it is detected from the process entry file.
     */
    moduleRoot?: string;
    commands?: {
        /** Override automatic detection for non-standard layouts. */
        path?: string;
        deployment(): CommandDeployment;
    };
    /** @deprecated Use moduleRoot or events.path. */
    eventsPath?: string;
    events?: {
        /** Override automatic detection for non-standard layouts. */
        path?: string;
        enabled?: boolean;
    };
    interactions?: {
        /** Override automatic detection for non-standard layouts. */
        path?: string;
        /** Defaults to the client's interactionRouter property. */
        router?: ClientInteractionRouter;
        enabled?: boolean;
    };
}

/**
 * 
 * Subclasses provide their configuration, logger, integrations, and startup
 * hooks while this class owns framework state and cleanup.
 */
export abstract class DiscordClient<
    TCommand extends BaseCommand<any> = BaseCommand<any>,
    TEvent extends BaseEvent<any, any, any> = BaseEvent<any, any, any>
> extends DiscordJsClient {
    readonly commands = new Collection<string, TCommand>();
    readonly events = new Collection<
        string,
        { handler: TEvent; listener: (...args: any[]) => void }
    >();
    readonly sessions = new SessionManager();
    readonly logger: ClientLogger;
    private moduleConfig: FrameworkModuleConfig = {};

    protected constructor(options: ClientOptions, frameworkOptions: FrameworkClientOptions = {}) {
        super(options);
        this.logger = frameworkOptions.logger
            ?? new Logger(frameworkOptions.loggerOptions ?? { writeToFile: true });
    }

    protected configureFrameworkModules(config: FrameworkModuleConfig): void {
        this.moduleConfig = config;
    }

    async loadCommands(refresh = false, deploy = false): Promise<void> {
        const commands = this.moduleConfig.commands;
        if (!commands) return;
        const commandsPath = this.resolveModuleDirectory("commands", commands.path);
        if (!commandsPath) return;
        await loadCommandModules({
            client: this as any,
            commandsPath,
            refresh,
            deploy,
            ...commands.deployment()
        });
    }

    async reloadCommands(deploy = false): Promise<void> {
        this.commands.clear();
        await this.loadCommands(true, deploy);
    }

    async loadEvents(refresh = false): Promise<void> {
        if (this.moduleConfig.events?.enabled === false) return;
        const eventsPath = this.resolveModuleDirectory(
            "events",
            this.moduleConfig.events?.path ?? this.moduleConfig.eventsPath
        );
        if (!eventsPath) return;
        await loadEventModules(this as any, eventsPath, refresh);
    }

    async reloadEvents(): Promise<void> {
        for (const [eventName, { listener }] of this.events) {
            this.off(eventName, listener);
        }
        this.events.clear();
        await this.loadEvents(true);
    }

    async loadInteractions(refresh = false): Promise<void> {
        if (this.moduleConfig.interactions?.enabled === false) return;
        const interactionsPath = this.resolveModuleDirectory(
            "interactions",
            this.moduleConfig.interactions?.path
        );
        const router = this.resolveInteractionRouter();
        if (!interactionsPath || !router) return;
        await loadInteractionModules(
            {
                logger: this.logger,
                interactionRouter: router
            },
            interactionsPath,
            refresh
        );
    }

    async reloadInteractions(): Promise<void> {
        const router = this.resolveInteractionRouter();
        if (!router) return;
        router.clear();
        await this.loadInteractions(true);
    }

    async loadFrameworkModules(): Promise<void> {
        await this.loadCommands();
        await this.loadEvents();
        await this.loadInteractions();
    }

    /**
     * Stop reusable framework resources. Subclasses should call super when
     * extending this method for databases, web servers, or other services.
     */
    async closeFramework(): Promise<void> {
        this.sessions.stopCleanup();
        this.removeAllListeners();
        this.destroy();
        this.logger.close?.();
    }

    protected startFrameworkServices(): void {
        this.sessions.startCleanup();
    }

    private resolveInteractionRouter(): ClientInteractionRouter | undefined {
        return this.moduleConfig.interactions?.router
            ?? (this as unknown as { interactionRouter?: ClientInteractionRouter }).interactionRouter;
    }

    private resolveModuleDirectory(
        name: "commands" | "events" | "interactions",
        override?: string
    ): string | undefined {
        if (override) return path.resolve(override);

        const entryDirectory = process.argv[1]
            ? path.dirname(path.resolve(process.argv[1]))
            : undefined;
        const candidates = uniquePaths([
            ...(this.moduleConfig.moduleRoot
                ? [path.join(path.resolve(this.moduleConfig.moduleRoot), name)]
                : []),
            ...(entryDirectory ? [path.join(entryDirectory, name)] : []),
            path.resolve(name),
            path.resolve("scripts", name),
            path.resolve("dist", name),
            path.resolve("build", name),
            path.resolve("src", name)
        ]);
        const detected = candidates.find(candidate => {
            try {
                return fs.statSync(candidate).isDirectory();
            } catch {
                return false;
            }
        });
        if (detected) this.logger.debug(`Detected ${name} modules at ${detected}`);
        return detected;
    }
}

function uniquePaths(paths: string[]): string[] {
    return [...new Set(paths)];
}
