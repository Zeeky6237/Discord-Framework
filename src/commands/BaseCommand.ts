import type {
    ActionRowBuilder,
    APIEmbedField,
    ButtonBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    InteractionDeferReplyOptions,
    Message,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder,
    SlashCommandSubcommandBuilder,
    SlashCommandSubcommandsOnlyBuilder
} from "discord.js";

// Core command contracts shared by every framework client.

export type CommandSource = "slash" | "chat";
export type EmbedTone = "success" | "info" | "warning" | "error";
export type CommandPermissionLevel = "everyone" | "moderator" | "administrator" | "owner";

export type CommandReply = string | {
    content?: string;
    embeds?: EmbedBuilder[];
    components?: ActionRowBuilder<ButtonBuilder>[];
};

export interface CommandEmbedReply {
    title: string;
    description: string;
    tone?: EmbedTone;
    fields?: APIEmbedField[];
    content?: string;
    components?: ActionRowBuilder<ButtonBuilder>[];
}

export interface RateLimitConfig {
    limit: number;
    windowMs: number;
    scope?: "global" | "guild";
}

export interface CommandUsage {
    slash?: string[];
    chat?: string[];
    examples?: {
        slash?: string[];
        chat?: string[];
    };
}

export interface CommandContext<TClient> {
    client: TClient;
    source: CommandSource;
    userId: string;
    guildId?: string | null;
    commandName: string;
    subcommandName?: string;
    reply(content: CommandReply): Promise<void>;
    embedReply(embed: EmbedBuilder | CommandEmbedReply): Promise<void>;
    invalidSyntax(message?: string): Promise<void>;
}

export interface SlashCommandContext<TClient> extends CommandContext<TClient> {
    source: "slash";
    interaction: ChatInputCommandInteraction;
}

export interface ChatCommandContext<TClient> extends CommandContext<TClient> {
    source: "chat";
    message: Message;
    args: string[];
}

export interface CommandOptions {
    cooldown?: number;
    rateLimit?: RateLimitConfig;
    ownerOnly?: boolean;
    guildOnly?: boolean;
    category?: string;
    ownerGuildsOnly?: string[];
    defer?: boolean | "auto";
    deferOptions?: InteractionDeferReplyOptions;
    slash?: boolean;
    chat?: boolean;
    chatName?: string;
    aliases?: string[];
    usage?: CommandUsage;
    hidden?: boolean;
    permissionLevel?: CommandPermissionLevel;
}

export abstract class BaseCommand<TClient = unknown> {
    abstract data:
        | SlashCommandBuilder
        | SlashCommandSubcommandsOnlyBuilder
        | SlashCommandOptionsOnlyBuilder;
    subcommands = new Map<string, BaseSubcommand<TClient>>();
    options: CommandOptions = { slash: true, chat: false };

    async execute(
        _ctx: SlashCommandContext<TClient> | ChatCommandContext<TClient>
    ): Promise<void> {}
}

export abstract class BaseSubcommand<TClient = unknown> {
    abstract data: SlashCommandSubcommandBuilder;
    options: CommandOptions = {};
    abstract execute(
        ctx: SlashCommandContext<TClient> | ChatCommandContext<TClient>
    ): Promise<void>;
}
