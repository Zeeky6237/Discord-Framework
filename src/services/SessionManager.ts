import { Collection } from "discord.js";

// Shared in-memory cooldown and rate-limit state.

export type SessionScope = "global" | "guild";

export interface CooldownOptions {
    userId: string;
    guildId?: string | null;
    key: string;
    duration: number;
    scope?: SessionScope;
}

export interface RateLimitOptions {
    userId: string;
    guildId?: string | null;
    key: string;
    limit: number;
    windowMs: number;
    scope?: SessionScope;
}

export interface LimitResult {
    limited: boolean;
    remainingMs: number;
}

export interface RateLimitResult extends LimitResult {
    remaining: number;
}

interface RateLimitBucket {
    count: number;
    resetAt: number;
}

export class SessionManager {
    private readonly sessions = new Collection<string, UserSession>();
    private cleanupTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly sessionTtl = 60 * 60 * 1_000,
        private readonly cleanupInterval = 10 * 60 * 1_000
    ) {}

    get(userId: string): UserSession {
        let session = this.sessions.get(userId);
        if (!session) {
            session = new UserSession(userId, this.sessionTtl);
            this.sessions.set(userId, session);
        }
        session.touch();
        return session;
    }

    checkCooldown(options: CooldownOptions): LimitResult {
        return this.get(options.userId).checkCooldown(options);
    }

    checkRateLimit(options: RateLimitOptions): RateLimitResult {
        return this.get(options.userId).checkRateLimit(options);
    }

    delete(userId: string): void {
        this.sessions.delete(userId);
    }

    startCleanup(): void {
        this.cleanupTimer ??= setInterval(() => this.cleanup(), this.cleanupInterval);
        this.cleanupTimer.unref();
    }

    stopCleanup(): void {
        if (!this.cleanupTimer) return;
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = undefined;
    }

    cleanup(now = Date.now()): void {
        for (const [userId, session] of this.sessions) {
            session.cleanup(now);
            if (session.isExpired(now)) this.sessions.delete(userId);
        }
    }
}

export class UserSession {
    private readonly globalCooldowns = new Collection<string, number>();
    private readonly guildCooldowns = new Collection<string, Collection<string, number>>();
    private readonly globalRateLimits = new Collection<string, RateLimitBucket>();
    private readonly guildRateLimits = new Collection<string, Collection<string, RateLimitBucket>>();
    private lastAccessed = Date.now();

    constructor(
        readonly userId: string,
        private readonly sessionTtl: number
    ) {}

    checkCooldown(options: CooldownOptions): LimitResult {
        const now = Date.now();
        const cooldowns = this.cooldownStore(options.scope ?? "guild", options.guildId);
        const expiresAt = cooldowns.get(options.key) ?? 0;
        if (expiresAt > now) {
            return { limited: true, remainingMs: expiresAt - now };
        }
        cooldowns.set(options.key, now + options.duration);
        return { limited: false, remainingMs: 0 };
    }

    checkRateLimit(options: RateLimitOptions): RateLimitResult {
        if (options.limit < 1 || options.windowMs < 1) {
            throw new RangeError("Rate limit and windowMs must both be greater than zero");
        }
        const now = Date.now();
        const store = this.rateLimitStore(options.scope ?? "guild", options.guildId);
        const bucket = store.get(options.key);
        if (!bucket || bucket.resetAt <= now) {
            store.set(options.key, { count: 1, resetAt: now + options.windowMs });
            return {
                limited: false,
                remaining: options.limit - 1,
                remainingMs: options.windowMs
            };
        }
        if (bucket.count >= options.limit) {
            return {
                limited: true,
                remaining: 0,
                remainingMs: bucket.resetAt - now
            };
        }
        bucket.count++;
        return {
            limited: false,
            remaining: options.limit - bucket.count,
            remainingMs: bucket.resetAt - now
        };
    }

    touch(): void {
        this.lastAccessed = Date.now();
    }

    cleanup(now = Date.now()): void {
        this.deleteExpired(this.globalCooldowns, now, value => value);
        this.deleteExpired(this.globalRateLimits, now, value => value.resetAt);
        for (const [guildId, store] of this.guildCooldowns) {
            this.deleteExpired(store, now, value => value);
            if (!store.size) this.guildCooldowns.delete(guildId);
        }
        for (const [guildId, store] of this.guildRateLimits) {
            this.deleteExpired(store, now, value => value.resetAt);
            if (!store.size) this.guildRateLimits.delete(guildId);
        }
    }

    isExpired(now = Date.now()): boolean {
        return now - this.lastAccessed > this.sessionTtl
            && !this.globalCooldowns.size
            && !this.guildCooldowns.size
            && !this.globalRateLimits.size
            && !this.guildRateLimits.size;
    }

    private cooldownStore(scope: SessionScope, guildId?: string | null): Collection<string, number> {
        if (scope === "global" || !guildId) return this.globalCooldowns;
        let store = this.guildCooldowns.get(guildId);
        if (!store) {
            store = new Collection();
            this.guildCooldowns.set(guildId, store);
        }
        return store;
    }

    private rateLimitStore(
        scope: SessionScope,
        guildId?: string | null
    ): Collection<string, RateLimitBucket> {
        if (scope === "global" || !guildId) return this.globalRateLimits;
        let store = this.guildRateLimits.get(guildId);
        if (!store) {
            store = new Collection();
            this.guildRateLimits.set(guildId, store);
        }
        return store;
    }

    private deleteExpired<T>(
        store: Collection<string, T>,
        now: number,
        expiresAt: (value: T) => number
    ): void {
        for (const [key, value] of store) {
            if (expiresAt(value) <= now) store.delete(key);
        }
    }
}

export const sessions = new SessionManager();
