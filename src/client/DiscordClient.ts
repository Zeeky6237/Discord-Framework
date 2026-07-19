import {
    Client as DiscordJsClient,
    Collection,
    type ClientOptions
} from "discord.js";
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
    commands?: {
        path: string;
        deployment(): CommandDeployment;
    };
    eventsPath?: string;
    interactions?: {
        path: string;
        router: ClientInteractionRouter;
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
        await loadCommandModules({
            client: this as any,
            commandsPath: commands.path,
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
        if (!this.moduleConfig.eventsPath) return;
        await loadEventModules(this as any, this.moduleConfig.eventsPath, refresh);
    }

    async reloadEvents(): Promise<void> {
        for (const [eventName, { listener }] of this.events) {
            this.off(eventName, listener);
        }
        this.events.clear();
        await this.loadEvents(true);
    }

    async loadInteractions(refresh = false): Promise<void> {
        const interactions = this.moduleConfig.interactions;
        if (!interactions) return;
        await loadInteractionModules(
            {
                logger: this.logger,
                interactionRouter: interactions.router
            },
            interactions.path,
            refresh
        );
    }

    async reloadInteractions(): Promise<void> {
        const interactions = this.moduleConfig.interactions;
        if (!interactions) return;
        interactions.router.clear();
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
}
