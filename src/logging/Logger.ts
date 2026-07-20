import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";


export interface LoggerOptions {
    /** Minimum severity written to the console and log file. Defaults to debug. */
    level?: LogLevel;
    writeToFile?: boolean;
    webhook?: WebhookLoggerOptions;
    logsDirectory?: string;
    maximumFileSize?: number;
}

export interface WebhookLoggerOptions {
    /** Discord webhook URL. Keep this value in an environment variable. */
    url: string;
    /** Minimum severity sent to the webhook. Defaults to error. */
    level?: LogLevel;
    username?: string;
    avatarURL?: string;
}

export interface LogColor {
    colored: string;
    uncolored: string;
}

export interface LogContent {
    message: string | LogColor;
    args: unknown[];
}

export type LogLevel =
    | "debug"
    | "info"
    | "warn"
    | "error"
    | "fatal"
    | "success"
    | "timer";

/**
 * 
 * File logging rotates `latest.log` daily or when it reaches the configured
 * size. The logs directory is created lazily, so importing the framework never
 * fails in a fresh project.
 */
export class Logger {
    private static readonly DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
    private readonly logsDirectory: string;
    private readonly latestPath: string;
    private readonly maximumFileSize: number;
    private stream: fs.WriteStream | undefined;
    private startTime = 0;
    private level: LogLevel;
    private readonly webhookQueue: string[] = [];
    private webhookWorker: Promise<void> | undefined;

    constructor(private readonly options: LoggerOptions = {}) {
        this.level = options.level ?? "debug";
        this.logsDirectory = path.resolve(options.logsDirectory ?? "./logs");
        this.latestPath = path.join(this.logsDirectory, "latest.log");
        this.maximumFileSize = options.maximumFileSize ?? Logger.DEFAULT_MAX_FILE_SIZE;
    }

    time(): this {
        this.startTime = performance.now();
        return this;
    }

    setLevel(level: LogLevel): this {
        this.level = level;
        return this;
    }

    getLevel(): LogLevel {
        return this.level;
    }

    end(message: string, debug = false): number {
        const elapsed = performance.now() - this.startTime;
        this.log(debug ? "debug" : "timer", `${message} ${elapsed.toFixed(3)}ms`);
        return elapsed;
    }

    debug(message: string, ...args: unknown[]): void {
        this.log("debug", message, ...args);
    }

    info(message: string, ...args: unknown[]): void {
        this.log("info", message, ...args);
    }

    timer(message: string, ...args: unknown[]): void {
        this.log("timer", message, ...args);
    }

    warn(message: string, ...args: unknown[]): void {
        this.log("warn", message, ...args);
    }

    error(message: string, ...args: unknown[]): void {
        this.log("error", message, ...args);
    }

    fatal(message: string, ...args: unknown[]): void {
        this.log("fatal", message, ...args);
    }

    success(message: string, ...args: unknown[]): void {
        this.log("success", message, ...args);
    }

    writeLog(level: LogLevel, message: string, ...args: unknown[]): void {
        if (!this.shouldLog(level)) return;
        const formatted = Logger.format(level, message);
        this.writeToFile(formatted.uncolored, ...args);
    }

    log(level: LogLevel, message: string, ...args: unknown[]): void {
        const local = this.shouldLog(level);
        const webhook = this.shouldSendWebhook(level);
        if (!local && !webhook) return;
        const formatted = Logger.format(level, message);
        if (local) {
            console.log(formatted.colored, ...args);
            if (this.options.writeToFile) this.writeToFile(formatted.uncolored, ...args);
        }
        if (webhook) this.enqueueWebhook(formatted.uncolored, args);
    }

    chalkLog(content: LogContent & { message: LogColor }, level: LogLevel): void {
        const local = this.shouldLog(level);
        const webhook = this.shouldSendWebhook(level);
        if (!local && !webhook) return;
        const uncolored = Logger.format(level, content.message.uncolored).uncolored;
        if (local) {
            const colored = Logger.format(level, content.message.colored).colored;
            if (this.options.writeToFile) this.writeToFile(uncolored, ...content.args);
            console.log(colored, ...content.args);
        }
        if (webhook) this.enqueueWebhook(uncolored, content.args);
    }

    async close(): Promise<void> {
        while (this.webhookWorker) await this.webhookWorker;
        const stream = this.stream;
        this.stream = undefined;
        if (stream) await new Promise<void>(resolve => stream.end(resolve));
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
    }

    private shouldSendWebhook(level: LogLevel): boolean {
        const webhook = this.options.webhook;
        return Boolean(webhook?.url)
            && LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[webhook?.level ?? "error"];
    }

    private enqueueWebhook(message: string, args: unknown[]): void {
        this.webhookQueue.push(truncateWebhookContent(`${message}${formatArguments(args)}`));
        if (!this.webhookWorker) {
            this.webhookWorker = this.drainWebhookQueue().finally(() => {
                this.webhookWorker = undefined;
                if (this.webhookQueue.length) this.enqueueWebhookWorker();
            });
        }
    }

    private enqueueWebhookWorker(): void {
        if (this.webhookWorker || !this.webhookQueue.length) return;
        this.webhookWorker = this.drainWebhookQueue().finally(() => {
            this.webhookWorker = undefined;
            if (this.webhookQueue.length) this.enqueueWebhookWorker();
        });
    }

    private async drainWebhookQueue(): Promise<void> {
        while (this.webhookQueue.length) {
            const content = this.webhookQueue.shift();
            if (content) await this.deliverWebhook(content);
        }
    }

    private async deliverWebhook(content: string): Promise<void> {
        const webhook = this.options.webhook;
        if (!webhook?.url) return;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const response = await fetch(webhook.url, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        content,
                        ...(webhook.username ? { username: webhook.username } : {}),
                        ...(webhook.avatarURL ? { avatar_url: webhook.avatarURL } : {})
                    })
                });
                if (response.ok) return;
                if (response.status === 429) {
                    await delay(await retryDelay(response));
                    continue;
                }
                if (response.status >= 500 && attempt < 2) {
                    await delay(500 * (attempt + 1));
                    continue;
                }
                console.error(`[Logger] Webhook delivery failed with HTTP ${response.status}.`);
                return;
            } catch {
                if (attempt < 2) {
                    await delay(500 * (attempt + 1));
                    continue;
                }
                console.error("[Logger] Webhook delivery failed.");
            }
        }
    }

    private static format(level: LogLevel, message: string): LogColor {
        const colors: Record<LogLevel, string> = {
            debug: chalk.gray("DEBUG"),
            info: chalk.blue("INFO"),
            timer: chalk.cyan("TIMER"),
            warn: chalk.yellow("WARN"),
            error: chalk.red("ERROR"),
            fatal: chalk.bold.red("FATAL"),
            success: chalk.green("SUCCESS")
        };
        const time = new Date().toLocaleTimeString();
        return {
            colored: `[${chalk.yellow(time)}] ${colors[level]} ${message}`,
            uncolored: `[${time}] ${level.toUpperCase()} ${message}`
        };
    }

    private writeToFile(message: string, ...args: unknown[]): void {
        this.ensureLogFile();
        const formatted = `${message}${formatArguments(args)}\n`;
        const stats = fs.statSync(this.latestPath);
        const fileDay = stats.mtime.toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        const rotateByDate = stats.size > 0 && fileDay !== today;
        const rotateBySize = stats.size + Buffer.byteLength(formatted) > this.maximumFileSize;
        if (rotateByDate || rotateBySize) this.rotateLog();
        this.getStream().write(formatted);
    }

    private ensureLogFile(): void {
        fs.mkdirSync(this.logsDirectory, { recursive: true });
        if (!fs.existsSync(this.latestPath)) fs.writeFileSync(this.latestPath, "");
    }

    private getStream(): fs.WriteStream {
        this.stream ??= fs.createWriteStream(this.latestPath, { flags: "a" });
        return this.stream;
    }

    private rotateLog(): void {
        this.stream?.end();
        this.stream = undefined;
        const date = new Date().toISOString().slice(0, 10);
        let number = 1;
        let archive: string;
        do {
            archive = path.join(this.logsDirectory, `${date}-${number}.log`);
            number++;
        } while (fs.existsSync(archive));
        fs.renameSync(this.latestPath, archive);
        fs.writeFileSync(this.latestPath, "");
    }
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    success: 1,
    timer: 1,
    warn: 2,
    error: 3,
    fatal: 4
};

function truncateWebhookContent(content: string): string {
    const maximumLength = 1_900;
    return content.length <= maximumLength
        ? content
        : `${content.slice(0, maximumLength - 14)}\n…[truncated]`;
}

async function retryDelay(response: Response): Promise<number> {
    try {
        const body = await response.json() as { retry_after?: unknown };
        if (typeof body.retry_after === "number") {
            return Math.max(250, body.retry_after * 1_000);
        }
    } catch {
        // Fall back to the Retry-After header or a conservative delay.
    }
    const header = Number(response.headers.get("retry-after"));
    return Number.isFinite(header) && header > 0 ? header * 1_000 : 1_000;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function formatArguments(args: unknown[]): string {
    if (!args.length) return "";
    return ` ${args.map(formatArgument).join(" ")}`;
}

function formatArgument(value: unknown): string {
    if (value instanceof Error) {
        return value.stack ?? `${value.name}: ${value.message}`;
    }
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        return String(value);
    }
}

export default Logger;
