import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
    type APIEmbedField,
    type PermissionsBitField
} from "discord.js";

import {
    BaseCommand,
    type BaseSubcommand,
    type CommandEmbedReply,
    type CommandPermissionLevel,
    type CommandSource,
    type SlashCommandContext,
    type ChatCommandContext
} from "./BaseCommand.js";

import {
    commandAvailable,
    commandDescription,
    commandDisplayName,
    commandPermissionLevel,
    exampleLines,
    permissionLabel,
    subcommandAvailable,
    usageLines,
    viewerPermissionLevel
} from "./commandHelper.js";

import type { InteractionRoute } from "../interactions/BaseInteraction.js";
import { themedEmbed, withRequester } from "../theme/index.js";

export interface HelpClient<TClient> {
    commands: Map<string, BaseCommand<TClient>>;
}

export interface HelpEntry<TClient> {
    command: BaseCommand<TClient>;
    subcommand?: BaseSubcommand<TClient>;
    name: string;
    description: string;
    level: CommandPermissionLevel;
}

export interface HelpDesign<TClient> {
    pageSize?: number;
    levels?: CommandPermissionLevel[];
    levelLabel?(level: CommandPermissionLevel): string;
    listTitle?(source: CommandSource, page: number, pages: number): string;
    listDescription?(source: CommandSource, prefix: string): string;
    entry?(entry: HelpEntry<TClient>): string;
    emptyField?: APIEmbedField;
    detailTitle?(command: BaseCommand<TClient>, subcommand: BaseSubcommand<TClient> | undefined, source: CommandSource, prefix: string): string;
    detailDescription?(command: BaseCommand<TClient>, subcommand?: BaseSubcommand<TClient>): string;
    previousLabel?: string;
    nextLabel?: string;
    previousEmoji?: string;
    nextEmoji?: string;
    previousStyle?: ButtonStyle;
    nextStyle?: ButtonStyle;
    transform?(embed: CommandEmbedReply, context: { kind: "list" | "detail" | "error"; source: CommandSource }): CommandEmbedReply | EmbedBuilder;
}

export interface HelpCommandConfig<TClient extends HelpClient<TClient>> {
    prefix(client: TClient): string;
    isOwner(client: TClient, userId: string): boolean;
    /** Register and expose the framework's help command. Defaults to true. */
    helpCommand?: boolean;
    /** Include command usage and examples in invalid-syntax replies. Defaults to true. */
    invalidUsageHelper?: boolean;
    design?: HelpDesign<TClient>;
    name?: string;
    description?: string;
    aliases?: string[];
    category?: string;
    slash?: boolean;
    chat?: boolean;
    show?(entry: HelpEntry<TClient>, context: { client: TClient; source: CommandSource; userId: string }): boolean;
    createPageCustomId?(client: TClient, source: CommandSource, page: number, userId: string): string;
}

export interface HelpPage {
    embed: CommandEmbedReply | EmbedBuilder;
    components: ActionRowBuilder<ButtonBuilder>[];
    page: number;
    pages: number;
}

const DEFAULT_LEVELS: CommandPermissionLevel[] = ["everyone", "moderator", "administrator", "owner"];

export function createHelpCommand<TClient extends HelpClient<TClient>>(
    config: HelpCommandConfig<TClient>
): new () => BaseCommand<TClient> {
    return class HelpCommand extends BaseCommand<TClient> {
        data = new SlashCommandBuilder()
            .setName(config.name ?? "help")
            .setDescription(config.description ?? "Show commands available to you")
            .addStringOption(option => option
                .setName("command")
                .setDescription("Command to show usage and examples for")
                .setMaxLength(64));

        options = {
            slash: config.helpCommand === false ? false : config.slash ?? true,
            chat: config.helpCommand === false ? false : config.chat ?? true,
            hidden: config.helpCommand === false,
            aliases: config.aliases ?? ["commands"],
            category: config.category ?? "General",
            usage: {
                slash: [`/${config.name ?? "help"} [command]`],
                chat: [`{prefix}${config.name ?? "help"} [command]`]
            }
        };

        async execute(ctx: SlashCommandContext<TClient> | ChatCommandContext<TClient>): Promise<void> {
            if (config.helpCommand === false) return;
            const query = ctx.source === "slash"
                ? ctx.interaction.options.getString("command")?.trim()
                : ctx.args.join(" ").trim();
            const permissions = ctx.source === "slash"
                ? ctx.interaction.memberPermissions
                : ctx.message.member?.permissions;
            if (query) await replyWithDetail(config, ctx, query, permissions);
            else {
                const result = buildHelpPage(config, ctx.client, ctx.source, ctx.userId, permissions, 0);
                if (result.embed instanceof EmbedBuilder) {
                    const displayName = ctx.source === "slash"
                        ? ctx.interaction.user.displayName
                        : ctx.message.member?.displayName ?? ctx.message.author.displayName;
                    const avatarURL = ctx.source === "slash"
                        ? ctx.interaction.user.displayAvatarURL({ size: 64 })
                        : ctx.message.author.displayAvatarURL({ size: 64 });
                    withRequester(result.embed, displayName, avatarURL);
                    await ctx.reply({ embeds: [result.embed], components: result.components });
                } else await ctx.embedReply({ ...result.embed, components: result.components });
            }
        }
    };
}

/**
 * Creates the `invalidSyntax` callback used by a command context. When the
 * helper is disabled it still sends the supplied error, but does not inspect
 * or reveal command usage metadata.
 */
export function createInvalidUsageHelper<TClient extends HelpClient<TClient>>(
    config: HelpCommandConfig<TClient>,
    context: Pick<SlashCommandContext<TClient> | ChatCommandContext<TClient>,
        "client" | "source" | "commandName" | "subcommandName" | "embedReply">
): (message?: string) => Promise<void> {
    return async (message = "The command arguments do not match the expected syntax.") => {
        const base: CommandEmbedReply = {
            tone: "error",
            title: config.invalidUsageHelper === false ? "Invalid command" : "Invalid command syntax",
            description: message
        };
        if (config.invalidUsageHelper === false) {
            await context.embedReply(transform(config, base, "error", context.source));
            return;
        }
        const command = context.client.commands.get(context.commandName);
        if (!command) {
            await context.embedReply(transform(config, base, "error", context.source));
            return;
        }
        const subcommand = context.subcommandName
            ? command.subcommands.get(context.subcommandName)
            : undefined;
        const prefix = config.prefix(context.client);
        const usage = usageLines(command, context.source, prefix, subcommand);
        const examples = exampleLines(command, context.source, prefix, subcommand);
        await context.embedReply(transform(config, {
            ...base,
            fields: [
                { name: "Usage", value: usage.map(line => `\`${line}\``).join("\n") },
                ...(examples.length ? [{ name: "Examples", value: examples.map(line => `\`${line}\``).join("\n") }] : [])
            ]
        }, "error", context.source));
    };
}

export function buildHelpPage<TClient extends HelpClient<TClient>>(
    config: HelpCommandConfig<TClient>,
    client: TClient,
    source: CommandSource,
    userId: string,
    permissions: Readonly<PermissionsBitField> | null | undefined,
    requestedPage: number
): HelpPage {
    const design = config.design ?? {};
    const levels = design.levels ?? DEFAULT_LEVELS;
    const prefix = config.prefix(client);
    const viewerLevel = viewerPermissionLevel(config.isOwner(client, userId), permissions);
    const entries = collectHelpEntries(config, client, source, userId, viewerLevel);
    const pageSize = Math.max(1, design.pageSize ?? 8);
    const pages = Math.max(1, Math.ceil(entries.length / pageSize));
    const page = Math.min(Math.max(0, requestedPage), pages - 1);
    const visible = entries.slice(page * pageSize, (page + 1) * pageSize);
    const fields = levels.flatMap(level => {
        const grouped = visible.filter(entry => entry.level === level);
        return grouped.length ? [{
            name: design.levelLabel?.(level) ?? permissionLabel(level),
            value: grouped.map(entry => design.entry?.(entry) ?? `**${entry.name}** — ${entry.description}`).join("\n")
        }] : [];
    });
    if (!fields.length) fields.push(design.emptyField ?? { name: "No commands", value: "No commands are available to you here." });
    const base: CommandEmbedReply = {
        tone: "info",
        title: design.listTitle?.(source, page, pages) ?? `${source === "slash" ? "Slash" : "Message"} commands • ${page + 1}/${pages}`,
        description: design.listDescription?.(source, prefix) ?? (source === "slash"
            ? "Use `/help command:<name>` for syntax and examples."
            : `Use \`${prefix}help <command>\` for syntax and examples.`),
        fields
    };
    const components = pageComponents(config, client, source, userId, page, pages);
    return {
        embed: design.transform?.(base, { kind: "list", source }) ?? base,
        components,
        page,
        pages
    };
}

export function createHelpPageRoute<TClient extends HelpClient<TClient>>(
    config: HelpCommandConfig<TClient>,
    route = "help-page"
): InteractionRoute<TClient, "button"> {
    return {
        kind: "button",
        route,
        async execute(ctx) {
            const [rawSource, rawPage, ownerId] = ctx.params;
            if (ctx.interaction.user.id !== ownerId) {
                await ctx.interaction.reply({ content: "Those help buttons belong to someone else.", flags: [MessageFlags.Ephemeral] });
                return;
            }
            if ((rawSource !== "slash" && rawSource !== "chat") || !rawPage || !Number.isSafeInteger(Number(rawPage))) {
                await ctx.interaction.reply({ content: "That help page is no longer valid.", flags: [MessageFlags.Ephemeral] });
                return;
            }
            const result = buildHelpPage(config, ctx.client, rawSource, ownerId, ctx.interaction.memberPermissions, Number(rawPage));
            const embed = result.embed instanceof EmbedBuilder ? result.embed : themedEmbed(result.embed);
            withRequester(embed, ctx.interaction.user.displayName, ctx.interaction.user.displayAvatarURL({ size: 64 }));
            await ctx.interaction.update({ embeds: [embed], components: result.components });
        }
    };
}

export function collectHelpEntries<TClient extends HelpClient<TClient>>(
    config: HelpCommandConfig<TClient>, client: TClient, source: CommandSource,
    userId: string, viewerLevel: CommandPermissionLevel
): HelpEntry<TClient>[] {
    const prefix = config.prefix(client);
    const entries: HelpEntry<TClient>[] = [];
    for (const command of client.commands.values()) {
        if (command.subcommands.size) {
            for (const subcommand of command.subcommands.values()) {
                if (!subcommandAvailable(command, subcommand, source, viewerLevel)) continue;
                const entry = { command, subcommand, name: `${commandDisplayName(command, source, prefix)} ${subcommand.data.name}`, description: subcommand.data.description, level: commandPermissionLevel(command, subcommand) };
                if (config.show?.(entry, { client, source, userId }) !== false) entries.push(entry);
            }
        } else if (commandAvailable(command, source, viewerLevel)) {
            const entry = { command, name: commandDisplayName(command, source, prefix), description: commandDescription(command), level: commandPermissionLevel(command) };
            if (config.show?.(entry, { client, source, userId }) !== false) entries.push(entry);
        }
    }
    const levels = config.design?.levels ?? DEFAULT_LEVELS;
    return entries.sort((a, b) => levels.indexOf(a.level) - levels.indexOf(b.level) || a.name.localeCompare(b.name));
}

async function replyWithDetail<TClient extends HelpClient<TClient>>(
    config: HelpCommandConfig<TClient>, ctx: SlashCommandContext<TClient> | ChatCommandContext<TClient>,
    query: string, permissions: Readonly<PermissionsBitField> | null | undefined
): Promise<void> {
    const [name, subName] = query.toLowerCase().split(/\s+/, 2);
    const prefix = config.prefix(ctx.client);
    const level = viewerPermissionLevel(config.isOwner(ctx.client, ctx.userId), permissions);
    const command = [...ctx.client.commands.values()].find(item => item.data.name === name || (ctx.source === "chat" && (item.options.chatName?.toLowerCase() === name || item.options.aliases?.some(alias => alias.toLowerCase() === name))));
    const available = command ? [...command.subcommands.values()].filter(sub => subcommandAvailable(command, sub, ctx.source, level)) : [];
    if (!command || (command.subcommands.size ? !available.length : !commandAvailable(command, ctx.source, level))) {
        await replyEmbed(ctx, transform(config, { tone: "error", title: "Command not found", description: `There is no command named **${name}** available to you.` }, "error", ctx.source));
        return;
    }
    const subcommand = subName ? command.subcommands.get(subName) : undefined;
    if (subName && (!subcommand || !subcommandAvailable(command, subcommand, ctx.source, level))) {
        await replyEmbed(ctx, transform(config, { tone: "error", title: "Subcommand not found", description: `**${command.data.name}** has no available subcommand named **${subName}**.` }, "error", ctx.source));
        return;
    }
    const targets = subcommand ? [subcommand] : command.subcommands.size ? available : [undefined];
    const usages = targets.flatMap(target => usageLines(command, ctx.source, prefix, target));
    const examples = targets.flatMap(target => exampleLines(command, ctx.source, prefix, target));
    const fields: APIEmbedField[] = [
        ...(subcommand || !command.subcommands.size ? [{ name: "Permission level", value: permissionLabel(commandPermissionLevel(command, subcommand)), inline: true }] : []),
        { name: "Usage", value: usages.map(line => `\`${line}\``).join("\n") },
        ...(examples.length ? [{ name: "Examples", value: examples.map(line => `\`${line}\``).join("\n") }] : []),
        ...(!subcommand && available.length ? [{ name: "Subcommands", value: available.map(item => `**${item.data.name}** · ${permissionLabel(commandPermissionLevel(command, item))} — ${item.data.description}`).join("\n") }] : []),
        ...(ctx.source === "chat" && command.options.aliases?.length ? [{ name: "Aliases", value: command.options.aliases.map(alias => `\`${prefix}${alias}\``).join(", ") }] : [])
    ];
    const base: CommandEmbedReply = {
        tone: "info",
        title: config.design?.detailTitle?.(command, subcommand, ctx.source, prefix) ?? `${commandDisplayName(command, ctx.source, prefix)}${subcommand ? ` ${subcommand.data.name}` : ""}`,
        description: config.design?.detailDescription?.(command, subcommand) ?? subcommand?.data.description ?? commandDescription(command),
        fields
    };
    await replyEmbed(ctx, transform(config, base, "detail", ctx.source));
}

function transform<TClient extends HelpClient<TClient>>(config: HelpCommandConfig<TClient>, embed: CommandEmbedReply, kind: "detail" | "error", source: CommandSource) {
    return config.design?.transform?.(embed, { kind, source }) ?? embed;
}

async function replyEmbed<TClient>(ctx: SlashCommandContext<TClient> | ChatCommandContext<TClient>, embed: CommandEmbedReply | EmbedBuilder) {
    await ctx.embedReply(embed);
}

function pageComponents<TClient extends HelpClient<TClient>>(config: HelpCommandConfig<TClient>, client: TClient, source: CommandSource, userId: string, page: number, pages: number): ActionRowBuilder<ButtonBuilder>[] {
    if (pages <= 1 || !config.createPageCustomId) return [];
    const design = config.design ?? {};
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(config.createPageCustomId(client, source, page - 1, userId)).setLabel(design.previousLabel ?? "Previous").setEmoji(design.previousEmoji ?? "◀").setStyle(design.previousStyle ?? ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(config.createPageCustomId(client, source, page + 1, userId)).setLabel(design.nextLabel ?? "Next").setEmoji(design.nextEmoji ?? "▶").setStyle(design.nextStyle ?? ButtonStyle.Primary).setDisabled(page === pages - 1)
    )];
}
