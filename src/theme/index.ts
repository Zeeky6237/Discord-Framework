import { EmbedBuilder, type APIEmbedField } from "discord.js";
import type { CommandEmbedReply, EmbedTone } from "../commands/BaseCommand.js";

export interface DiscordTheme {
    primary: number;
    member: number;
    error: number;
    warning: number;
    name: string;
    footer: string;
    iconURL?: string;
}

export const DEFAULT_THEME: DiscordTheme = {
    primary: 0x02ff6b,
    member: 0x075f2b,
    error: 0xff4d67,
    warning: 0xffc857,
    name: "FTW SMP",
    footer: "FTW SMP  •  ftwsmp.net",
    iconURL: ""
};

let activeTheme: DiscordTheme = { ...DEFAULT_THEME };

export function configureTheme(theme: Partial<DiscordTheme>): void {
    activeTheme = { ...activeTheme, ...theme };
}

export function getTheme(): Readonly<DiscordTheme> {
    return activeTheme;
}

export function themedEmbed(options: CommandEmbedReply): EmbedBuilder {
    const tone = options.tone ?? "info";
    const style = styles(activeTheme)[tone];
    return addFields(
        new EmbedBuilder()
            .setColor(style.color)
            .setAuthor({
                name: activeTheme.name,
                ...(activeTheme.iconURL ? { iconURL: activeTheme.iconURL } : {})
            })
            .setTitle(`${style.icon}  ${options.title}`)
            .setDescription(options.description)
            .setFooter({ text: activeTheme.footer })
            .setTimestamp(),
        options.fields
    );
}

export function successEmbed(
    title: string,
    description: string,
    fields: APIEmbedField[] = []
): EmbedBuilder {
    return themedEmbed({ tone: "success", title, description, fields });
}

export function infoEmbed(
    title: string,
    description: string,
    fields: APIEmbedField[] = []
): EmbedBuilder {
    return themedEmbed({ tone: "info", title, description, fields });
}

export function warningEmbed(title: string, description: string): EmbedBuilder {
    return themedEmbed({ tone: "warning", title, description });
}

export function errorEmbed(title: string, description: string): EmbedBuilder {
    return themedEmbed({ tone: "error", title, description });
}

export function withRequester(
    embed: EmbedBuilder,
    displayName: string,
    avatarURL?: string
): EmbedBuilder {
    return embed.setFooter({
        text: `${activeTheme.name}  •  Requested by ${displayName}`,
        ...(avatarURL ? { iconURL: avatarURL } : {})
    });
}

function addFields(embed: EmbedBuilder, fields?: APIEmbedField[]): EmbedBuilder {
    if (fields?.length) {
        embed.addFields(fields.map(field => ({
            ...field,
            value: field.value || "—"
        })));
    }
    return embed;
}

function styles(theme: DiscordTheme): Record<EmbedTone, { color: number; icon: string }> {
    return {
        success: { color: theme.primary, icon: "✓" },
        info: { color: theme.member, icon: "◆" },
        warning: { color: theme.warning, icon: "!" },
        error: { color: theme.error, icon: "×" }
    };
}
