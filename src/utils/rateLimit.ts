import type { CommandSource, RateLimitConfig } from "../commands/BaseCommand.js";
import type { SessionManager } from "../services/SessionManager.js";

export interface CommandRateLimitOptions {
    sessions: Pick<SessionManager, "checkRateLimit">;
    userId: string;
    guildId: string | null;
    source: CommandSource;
    commandKey: string;
    rateLimit?: RateLimitConfig;
    generalLimit?: number;
    generalWindowMs?: number;
}

export function checkCommandRateLimits(options: CommandRateLimitOptions) {
    const generalResult = options.sessions.checkRateLimit({
        userId: options.userId,
        guildId: options.guildId,
        key: `commands:${options.source}`,
        limit: options.generalLimit ?? 5,
        windowMs: options.generalWindowMs ?? 10_000,
        scope: "global"
    });
    if (generalResult.limited) return { ...generalResult, type: "general" as const };
    if (!options.rateLimit) return;
    const commandResult = options.sessions.checkRateLimit({
        userId: options.userId,
        guildId: options.guildId,
        key: `command:${options.commandKey}`,
        ...options.rateLimit
    });
    if (commandResult.limited) return { ...commandResult, type: "command" as const };
}
