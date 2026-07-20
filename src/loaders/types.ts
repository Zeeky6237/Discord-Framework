export interface LoaderLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
}
