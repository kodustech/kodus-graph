import { authenticate } from '../lib';
export function login(u: string, p: string): boolean {
    return authenticate(u, p);
}
