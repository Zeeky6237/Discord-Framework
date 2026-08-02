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
    showRequester: boolean;
}

export const DEFAULT_THEME: DiscordTheme = {
    primary: 0x02ff6b,
    member: 0x075f2b,
    error: 0xff4d67,
    warning: 0xffc857,
    name: "",
    footer: "",
    iconURL: "",
    showRequester: true
};

let activeTheme: DiscordTheme = { ...DEFAULT_THEME };

/** @deprecated Pass theme through DiscordClientOptions instead. */
export function configureTheme(theme: Partial<DiscordTheme> = {}): void {
    activeTheme = { ...DEFAULT_THEME, ...theme };
}

export function getTheme(): Readonly<DiscordTheme> {
    return activeTheme;
}

export function themedEmbed(options: CommandEmbedReply): EmbedBuilder {
    const tone = options.tone ?? "info";
    const style = styles(activeTheme)[tone];
    const title = nonEmpty(options.title);
    const description = nonEmpty(options.description);
    const embed = new EmbedBuilder()
        .setColor(style.color)
        .setTimestamp();
    const authorName = nonEmpty(activeTheme.name);
    const iconURL = nonEmpty(activeTheme.iconURL);
    const footer = nonEmpty(
        options.footer === undefined ? activeTheme.footer : options.footer
    );
    if (title) embed.setTitle(`${style.icon}  ${title}`);
    if (description) embed.setDescription(description);
    if (authorName) {
        embed.setAuthor({
            name: authorName,
            ...(iconURL ? { iconURL } : {})
        });
    }
    if (footer) embed.setFooter({ text: footer });
    return addFields(embed, options.fields);
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
    if (!activeTheme.showRequester) return embed;

    const branding = nonEmpty(activeTheme.name);
    const requester = nonEmpty(displayName) ?? "Unknown user";
    const requesterAvatarURL = nonEmpty(avatarURL);
    const existingFooter = nonEmpty(embed.data.footer?.text);
    const existingFooterIconURL = nonEmpty(embed.data.footer?.icon_url);
    const footerPrefix = existingFooter ?? branding;
    const footerIconURL = requesterAvatarURL ?? existingFooterIconURL;
    return embed.setFooter({
        text: footerPrefix
            ? `${footerPrefix}  •  Requested by ${requester}`
            : `Requested by ${requester}`,
        ...(footerIconURL ? { iconURL: footerIconURL } : {})
    });
}

function nonEmpty(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
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
