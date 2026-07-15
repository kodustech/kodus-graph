export function slugify(text: string, max: number): string {
    return text.slice(0, max).toLowerCase();
}
