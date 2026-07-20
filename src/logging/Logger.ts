import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";


export interface LoggerOptions {
    writeToFile?: boolean;
    sendWebhook?: boolean;
    logsDirectory?: string;
    maximumFileSize?: number;
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

    constructor(private readonly options: LoggerOptions = {}) {
        this.logsDirectory = path.resolve(options.logsDirectory ?? "./logs");
        this.latestPath = path.join(this.logsDirectory, "latest.log");
        this.maximumFileSize = options.maximumFileSize ?? Logger.DEFAULT_MAX_FILE_SIZE;
    }

    time(): this {
        this.startTime = performance.now();
        return this;
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
        const formatted = Logger.format(level, message);
        this.writeToFile(formatted.uncolored, ...args);
    }

    log(level: LogLevel, message: string, ...args: unknown[]): void {
        const formatted = Logger.format(level, message);
        console.log(formatted.colored, ...args);
        if (this.options.writeToFile) this.writeToFile(formatted.uncolored, ...args);
    }

    chalkLog(content: LogContent & { message: LogColor }, level: LogLevel): void {
        const uncolored = Logger.format(level, content.message.uncolored).uncolored;
        const colored = Logger.format(level, content.message.colored).colored;
        if (this.options.writeToFile) this.writeToFile(uncolored, ...content.args);
        console.log(colored, ...content.args);
    }

    close(): void {
        this.stream?.end();
        this.stream = undefined;
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
