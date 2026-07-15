import { UserRepository } from './user-repo';
import { makeQuery } from './query';

export function persistUser(name: string): string {
    const repo = new UserRepository();
    // método herdado de BaseRepository — só resolve com classHierarchy
    return repo.save(name);
}

export function runQuery(): string {
    // chain: makeQuery() retorna QueryBuilder; .where() retorna QueryBuilder
    // só resolve o .execute() final com returnTypes
    return makeQuery().where('x = 1').execute();
}
