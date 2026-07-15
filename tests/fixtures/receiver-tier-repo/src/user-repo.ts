import { BaseRepository } from './base';
export class UserRepository extends BaseRepository {
    findByName(name: string): string {
        return `user:${name}`;
    }
}
