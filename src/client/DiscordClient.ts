import fs from "node:fs";
import path from "node:path";

import {
    Client as DiscordJsClient,
    Collection,
    Events,
    type CacheType,
    type ClientOptions,
    type Interaction
} from "discord.js";

import {
    Logger,
    type LoggerOptions,
    type LogContent,
    type LogColor,
    type LogLevel
} from "../logging/Logger.js";

import {
    loadInteractions as loadInteractionModules,
    loadCommands as loadCommandModules,
    loadEvents as loadEventModules
} from "../loaders/index.js";

import { SessionManager } from "../services/SessionManager.js";
import type { BaseCommand } from "../commands/BaseCommand.js";
import type { BaseEvent } from "../events/BaseEvent.js";
import { InteractionCreateEvent } from "../events/InteractionCreateEvent.js";
import { MessageCreateEvent } from "../events/MessageCreateEvent.js";
import type { AnyInteractionRoute } from "../interactions/BaseInteraction.js";
import { InteractionRouter } from "../interactions/InteractionRouter.js";

import {
    BuiltInHelpCommand,
    builtInHelpPageRoute,
    replyInvalidUsage as sendInvalidUsage,
    type HelpCommandConfig,
    type HelpOptions
} from "../commands/HelpCommand.js";

import type {
    ChatCommandContext,
    SlashCommandContext
} from "../commands/BaseCommand.js";
import {
    configureTheme,
    type DiscordTheme
} from "../theme/index.js";


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
    setLevel?(level: LogLevel): unknown;
    getLevel?(): LogLevel;
    close?(): void | Promise<void>;
}

export interface ClientInteractionRouter<TClient = any> {
    clear(): void;
    register(route: AnyInteractionRoute<TClient>): void;
    createCustomId(route: string, ...params: Array<string | number>): string;
    dispatch(
        client: TClient,
        interaction: Interaction<CacheType>
    ): Promise<boolean>;
}

export interface CommandDeployment {
    token: string;
    applicationId: string;
    /** Guilds that receive development-only commands. */
    developmentGuilds?: Iterable<string>;
}

export interface DiscordClientOptions<
    TClient extends DiscordClient<any, any, any> = DiscordClient<any, any, any>
> extends ClientOptions {
    /** Built-in logger settings, or a custom logger instance. */
    logger?: LoggerOptions | ClientLogger;
    /** Embed branding and colors applied by the framework's reply helpers. */
    theme?: Partial<DiscordTheme>;
    /**
     * Runtime directory containing commands, events, and interactions.
     * Normally omitted because it is detected from the process entry file.
     */
    moduleRoot?: string;
    commands?: {
        /** Override automatic detection for non-standard layouts. */
        path?: string;
        deployment(client: TClient): CommandDeployment;
        /** Prefix used by message commands and generated usage text. */
        prefix?(client: TClient): string;
        /** Determines owner-only command access and help visibility. */
        isOwner?(client: TClient, userId: string): boolean;
        /** Enable and configure the framework-owned help command. */
        help?: boolean | HelpOptions<TClient>;
        /** Show generated usage and examples for invalid syntax. Defaults to true. */
        invalidUsageHelper?: boolean;
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
        /** Override the framework-owned interaction router. */
        router?: ClientInteractionRouter<TClient>;
        enabled?: boolean;
    };
}

type FrameworkModuleConfig<TClient extends DiscordClient<any, any, any>> = Pick<
    DiscordClientOptions<TClient>,
    "moduleRoot" | "commands" | "eventsPath" | "events" | "interactions"
>;

/**
 * 
 * Subclasses provide their configuration, logger, integrations, and startup
 * hooks while this class owns framework state and cleanup.
 */
export abstract class DiscordClient<
    TClient extends DiscordClient<any, any, any> = DiscordClient<any, any, any>,
    TCommand extends BaseCommand<TClient> = BaseCommand<TClient>,
    TEvent extends BaseEvent<any, any, TClient> = BaseEvent<any, any, TClient>
> extends DiscordJsClient {
    readonly commands = new Collection<string, TCommand>();
    readonly events = new Collection<
        string,
        { handler: TEvent; listener: (...args: any[]) => void }
    >();
    readonly sessions = new SessionManager();
    readonly logger: ClientLogger;
    private readonly moduleConfig: FrameworkModuleConfig<TClient>;
    private readonly frameworkInteractionRouter: InteractionRouter<TClient>;

    protected constructor(options: DiscordClientOptions<TClient>) {
        super(discordJsOptions(options));
        this.moduleConfig = frameworkModuleConfig(options);
        this.logger = isClientLogger(options.logger)
            ? options.logger
            : new Logger({ writeToFile: true, ...options.logger });
        configureTheme(options.theme);
        this.frameworkInteractionRouter = new InteractionRouter<TClient>();
    }

    async loadCommands(refresh = false, deploy = false): Promise<void> {
        const commands = this.moduleConfig.commands;
        if (!commands) return;
        const commandsPath = this.resolveModuleDirectory("commands", commands.path);
        if (!commandsPath && !this.helpEnabled()) return;
        await loadCommandModules({
            client: this as any,
            ...(commandsPath ? { commandsPath } : {}),
            refresh,
            deploy,
            builtInCommands: this.builtInCommands(),
            ...commands.deployment(this.typedClient())
        });
    }

    async reloadCommands(deploy = false): Promise<void> {
        this.commands.clear();
        await this.loadCommands(true, deploy);
    }

    async loadEvents(refresh = false): Promise<void> {
        if (this.moduleConfig.events?.enabled === false) return;
        this.loadBuiltInEvents();
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
        const router = this.resolveInteractionRouter();
        const interactionsPath = this.resolveModuleDirectory(
            "interactions",
            this.moduleConfig.interactions?.path
        );
        if (this.moduleConfig.interactions?.enabled !== false && interactionsPath) {
            await loadInteractionModules(
                {
                    logger: this.logger,
                    interactionRouter: router
                },
                interactionsPath,
                refresh
            );
        }
        const helpConfig = this.helpEnabled() ? this.helpConfig(true) : undefined;
        if (helpConfig) {
            const help = this.moduleConfig.commands?.help;
            const route = typeof help === "object" ? help.route : undefined;
            router.register(builtInHelpPageRoute(helpConfig, route ?? "framework-help-page"));
        }
    }

    async reloadInteractions(): Promise<void> {
        const router = this.resolveInteractionRouter();
        router.clear();
        await this.loadInteractions(true);
    }

    createInteractionCustomId(
        route: string,
        ...params: Array<string | number>
    ): string {
        return this.resolveInteractionRouter().createCustomId(route, ...params);
    }

    dispatchInteraction(
        interaction: Interaction<CacheType>
    ): Promise<boolean> {
        return this.resolveInteractionRouter().dispatch(this.typedClient(), interaction);
    }

    async loadFrameworkModules(): Promise<void> {
        await this.loadCommands();
        await this.loadEvents();
        await this.loadInteractions();
        this.startFrameworkServices();
    }

    /** Prefix used to identify message commands. */
    commandPrefix(): string {
        return this.moduleConfig.commands?.prefix?.(this.typedClient()) ?? "!";
    }

    /** Whether a user can execute commands marked as owner-only. */
    isCommandOwner(userId: string): boolean {
        return this.moduleConfig.commands?.isOwner?.(this.typedClient(), userId) ?? false;
    }

    /**
     * Stop reusable framework resources. Subclasses should call super when
     * extending this method for databases, web servers, or other services.
     */
    async closeFramework(): Promise<void> {
        this.sessions.stopCleanup();
        this.removeAllListeners();
        this.destroy();
        await this.logger.close?.();
    }

    protected startFrameworkServices(): void {
        this.sessions.startCleanup();
    }

    async replyInvalidUsage(
        context: Pick<SlashCommandContext<TClient> | ChatCommandContext<TClient>,
            "client" | "source" | "commandName" | "subcommandName" | "embedReply">,
        message?: string
    ): Promise<void> {
        const config = this.helpConfig(false);
        if (!config) {
            await context.embedReply({
                tone: "error",
                title: "Invalid command",
                description: message ?? "The command arguments do not match the expected syntax."
            });
            return;
        }
        await sendInvalidUsage(config, context, message);
    }

    private resolveInteractionRouter(): ClientInteractionRouter<TClient> {
        return this.moduleConfig.interactions?.router
            ?? (this as unknown as {
                interactionRouter?: ClientInteractionRouter<TClient>;
            }).interactionRouter
            ?? this.frameworkInteractionRouter;
    }

    private loadBuiltInEvents(): void {
        if (!this.events.has(Events.InteractionCreate)) {
            this.registerBuiltInEvent(
                Events.InteractionCreate,
                new InteractionCreateEvent<TClient>()
            );
        }
        if (!this.events.has(Events.MessageCreate)) {
            this.registerBuiltInEvent(
                Events.MessageCreate,
                new MessageCreateEvent<TClient>()
            );
        }
    }

    private registerBuiltInEvent(
        eventName: string,
        handler: BaseEvent<any, any, TClient>
    ): void {
        const listener = (...args: any[]) =>
            handler.execute(this.typedClient(), args[0]);
        this.on(eventName, listener);
        this.events.set(eventName, {
            handler: handler as TEvent,
            listener
        });
        this.logger.info(`├─ Loaded built-in event ${eventName}`);
    }

    private builtInCommands(): BaseCommand<TClient>[] {
        if (!this.helpEnabled()) return [];
        const config = this.helpConfig(true);
        return config ? [new BuiltInHelpCommand<TClient>(config)] : [];
    }

    private helpEnabled(): boolean {
        const help = this.moduleConfig.commands?.help;
        return help === true || typeof help === "object";
    }

    private helpConfig(pagination: boolean): HelpCommandConfig<TClient> | undefined {
        const commands = this.moduleConfig.commands;
        if (!commands) return;
        const rawHelp = commands.help;
        const helpEnabled = rawHelp === true || typeof rawHelp === "object";
        if (!helpEnabled && commands.invalidUsageHelper === undefined) return;
        const help = typeof rawHelp === "object" ? rawHelp : {};
        const route = help.route ?? "framework-help-page";
        const { route: _route, ...helpOptions } = help;
        return {
            ...helpOptions,
            prefix: commands.prefix ?? (() => "!"),
            isOwner: commands.isOwner ?? (() => false),
            helpCommand: helpEnabled,
            invalidUsageHelper: commands.invalidUsageHelper ?? true,
            ...(pagination ? {
                createPageCustomId: (_client, source, page, userId) =>
                    this.createInteractionCustomId(route, source, page, userId)
            } : {})
        };
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

    private typedClient(): TClient {
        return this as unknown as TClient;
    }
}

function uniquePaths(paths: string[]): string[] {
    return [...new Set(paths)];
}

function discordJsOptions<TClient extends DiscordClient<any, any, any>>(
    options: DiscordClientOptions<TClient>
): ClientOptions {
    const {
        logger: _logger,
        theme: _theme,
        moduleRoot: _moduleRoot,
        commands: _commands,
        eventsPath: _eventsPath,
        events: _events,
        interactions: _interactions,
        ...clientOptions
    } = options;
    return clientOptions;
}

function frameworkModuleConfig<TClient extends DiscordClient<any, any, any>>(
    options: DiscordClientOptions<TClient>
): FrameworkModuleConfig<TClient> {
    return {
        ...(options.moduleRoot ? { moduleRoot: options.moduleRoot } : {}),
        ...(options.commands ? { commands: options.commands } : {}),
        ...(options.eventsPath ? { eventsPath: options.eventsPath } : {}),
        ...(options.events ? { events: options.events } : {}),
        ...(options.interactions ? { interactions: options.interactions } : {})
    };
}

function isClientLogger(logger: LoggerOptions | ClientLogger | undefined): logger is ClientLogger {
    return Boolean(logger)
        && typeof (logger as Partial<ClientLogger>).info === "function"
        && typeof (logger as Partial<ClientLogger>).error === "function";
}
