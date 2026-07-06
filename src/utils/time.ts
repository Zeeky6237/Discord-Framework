export type TimeUnit = "ms" | "ticks" | "seconds";

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatTime(time: number, unit: TimeUnit = "ms"): string {
    let totalSeconds = unit === "ms" ? time / 1_000 : unit === "ticks" ? time / 20 : time;
    const units: Array<[number, string]> = [
        [31_536_000, "y"],
        [2_628_000, "mo"],
        [604_800, "w"],
        [86_400, "d"],
        [3_600, "h"],
        [60, "m"]
    ];
    const parts: string[] = [];
    for (const [size, suffix] of units) {
        const amount = Math.floor(totalSeconds / size);
        totalSeconds %= size;
        if (amount) parts.push(`${amount}${suffix}`);
    }
    const seconds = Math.round(totalSeconds * 1_000) / 1_000;
    if (seconds || !parts.length) parts.push(`${seconds}s`);
    return parts.join(" ");
}

export function convertTime(value: number, from: TimeUnit, to: TimeUnit): number {
    if (from === to) return value;
    const milliseconds: Record<TimeUnit, number> = {
        ticks: 50,
        ms: 1,
        seconds: 1_000
    };
    return value * milliseconds[from] / milliseconds[to];
}
