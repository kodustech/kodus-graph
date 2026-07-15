declare function handleError(e: Error): string;

export function run(e: Error): string {
    return handleError(e);
}
