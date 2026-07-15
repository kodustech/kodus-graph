export class QueryBuilder {
    where(cond: string): QueryBuilder {
        return this;
    }
    execute(): string {
        return 'rows';
    }
}
export function makeQuery(): QueryBuilder {
    return new QueryBuilder();
}
