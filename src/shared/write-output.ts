import { writeFileSync } from 'fs';

/**
 * Write string content to a file path, or to stdout when `out === '-'`.
 *
 * Info logs should go to stderr (see `src/shared/logger.ts`) so stdout
 * stays clean for piping.
 */
export function writeOutput(out: string, content: string): void {
    if (out === '-') {
        // Ensure a trailing newline when writing to stdout so the shell
        // prompt doesn't appear glued to the output.
        const needsNewline = content.length === 0 || content[content.length - 1] !== '\n';
        process.stdout.write(needsNewline ? `${content}\n` : content);
    } else {
        writeFileSync(out, content);
    }
}
