export class BaseRepository {
    save(entity: string): string {
        return `saved:${entity}`;
    }
}
