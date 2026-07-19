import {
    ApplicationCommandOptionType,
    PermissionFlagsBits,
    type PermissionsBitField
} from "discord.js";
import type {
    BaseCommand,
    BaseSubcommand,
    CommandPermissionLevel,
    CommandSource
} from "./BaseCommand.js";

const PERMISSION_ORDER: Record<CommandPermissionLevel, number> = {
    everyone: 0,
    moderator: 1,
    administrator: 2,
    owner: 3
};

export function commandAvailable<TClient>(
    command: BaseCommand<TClient>,
    source: CommandSource,
    viewerLevel: CommandPermissionLevel
): boolean {
    return !command.options.hidden
        && commandAvailableForSource(command, source)
        && canAccess(viewerLevel, commandPermissionLevel(command));
}

export function subcommandAvailable<TClient>(
    command: BaseCommand<TClient>,
    subcommand: BaseSubcommand<TClient>,
    source: CommandSource,
    viewerLevel: CommandPermissionLevel
): boolean {
    return commandAvailableForSource(command, source)
        && !subcommand.options.hidden
        && canAccess(viewerLevel, commandPermissionLevel(command, subcommand));
}

export function commandPermissionLevel<TClient>(
    command: BaseCommand<TClient>,
    subcommand?: BaseSubcommand<TClient>
): CommandPermissionLevel {
    if (subcommand?.options.ownerOnly || command.options.ownerOnly) return "owner";
    return subcommand?.options.permissionLevel
        ?? command.options.permissionLevel
        ?? "everyone";
}

export function viewerPermissionLevel(
    owner: boolean,
    permissions?: Readonly<PermissionsBitField> | null
): CommandPermissionLevel {
    if (owner) return "owner";
    if (permissions?.has(PermissionFlagsBits.Administrator)
        || permissions?.has(PermissionFlagsBits.BanMembers)) return "administrator";
    if (permissions?.has(PermissionFlagsBits.ModerateMembers)
        || permissions?.has(PermissionFlagsBits.KickMembers)) return "moderator";
    return "everyone";
}

export function canAccess(
    viewerLevel: CommandPermissionLevel,
    requiredLevel: CommandPermissionLevel
): boolean {
    return PERMISSION_ORDER[viewerLevel] >= PERMISSION_ORDER[requiredLevel];
}

export function permissionLabel(level: CommandPermissionLevel): string {
    return {
        everyone: "Everyone",
        moderator: "Moderators",
        administrator: "Administrators",
        owner: "Bot Owners"
    }[level];
}

export function commandDisplayName<TClient>(
    command: BaseCommand<TClient>,
    source: CommandSource,
    prefix: string
): string {
    return source === "slash"
        ? `/${command.data.name}`
        : `${prefix}${command.options.chatName ?? command.data.name}`;
}

export function commandDescription<TClient>(command: BaseCommand<TClient>): string {
    return command.data.description || "No description provided.";
}

export function usageLines<TClient>(
    command: BaseCommand<TClient>,
    source: CommandSource,
    prefix: string,
    subcommand?: BaseSubcommand<TClient>
): string[] {
    const explicit = subcommand?.options.usage?.[source] ?? command.options.usage?.[source];
    if (explicit?.length) return replacePrefix(explicit, prefix);
    if (source === "chat") {
        return [`${prefix}${command.options.chatName ?? command.data.name}${subcommand ? ` ${subcommand.data.name}` : ""}`];
    }
    if (subcommand) {
        const data = subcommand.data.toJSON();
        return [`/${command.data.name} ${data.name}${optionSyntax(data.options)}`];
    }
    if (command.subcommands.size) {
        return [...command.subcommands.values()].map(item => {
            const data = item.data.toJSON();
            return `/${command.data.name} ${data.name}${optionSyntax(data.options)}`;
        });
    }
    const data = command.data.toJSON();
    return [`/${data.name}${optionSyntax(data.options)}`];
}

export function exampleLines<TClient>(
    command: BaseCommand<TClient>,
    source: CommandSource,
    prefix: string,
    subcommand?: BaseSubcommand<TClient>
): string[] {
    return replacePrefix(
        subcommand?.options.usage?.examples?.[source]
            ?? command.options.usage?.examples?.[source]
            ?? [],
        prefix
    );
}

function replacePrefix(lines: string[], prefix: string): string[] {
    return lines.map(line => line.replaceAll("{prefix}", prefix));
}

function commandAvailableForSource<TClient>(command: BaseCommand<TClient>, source: CommandSource): boolean {
    return source === "slash" ? command.options.slash !== false : command.options.chat === true;
}

function optionSyntax(
    options: readonly { type: number; name: string; required?: boolean | undefined }[] | undefined
): string {
    return options?.filter(option => option.type !== ApplicationCommandOptionType.Subcommand
        && option.type !== ApplicationCommandOptionType.SubcommandGroup)
        .map(option => option.required ? ` <${option.name}>` : ` [${option.name}]`)
        .join("") ?? "";
}
