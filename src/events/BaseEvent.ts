// Prioritized, cancellable event pipeline.
export interface FrameworkEventLogger {
    debug(...values: unknown[]): void;
    time(): void;
    end(message: string, silent?: boolean): void;
}

export interface EventClient {
    logger: FrameworkEventLogger;
}

type EventHandler<TContext> = (ctx: TContext) => void | Promise<void>;

interface HandlerEntry<TContext> {
    priority: number;
    handler: EventHandler<TContext>;
}

export interface InternalEventContext {
    cancelled: boolean;
    cancel(): void;
}

export interface EventContext<TClient extends EventClient> extends InternalEventContext {
    client: TClient;
}

export abstract class BaseEvent<
    TEvent,
    TContext extends EventContext<TClient>,
    TClient extends EventClient = EventClient
> {
    protected handlers: HandlerEntry<TContext>[] = [];

    use(handler: EventHandler<TContext>, priority = 0): this {
        this.handlers.push({ handler, priority });
        this.handlers.sort((left, right) => right.priority - left.priority);
        return this;
    }

    protected createContext(ctx: Omit<TContext, keyof InternalEventContext>): TContext {
        return {
            ...ctx,
            cancelled: false,
            cancel() {
                this.cancelled = true;
            }
        } as TContext;
    }

    protected async run(ctx: TContext): Promise<void> {
        for (const { handler, priority } of this.handlers) {
            if (ctx.cancelled) {
                ctx.client.logger.debug(`[${this.constructor.name}] Cancelled pipeline`);
                break;
            }
            const eventName = this.constructor.name;
            const handlerName = handler.name || "anonymous";
            ctx.client.logger.time();
            await handler(ctx);
            ctx.client.logger.end(
                `[${eventName}] (handler=${handlerName}) (priority=${priority}) finished in`,
                true
            );
        }
    }

    abstract execute(client: TClient, event: TEvent): Promise<void>;
}
