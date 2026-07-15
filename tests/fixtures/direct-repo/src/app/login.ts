import { authenticate } from '../lib/auth';
export function login(u: string, p: string): boolean {
    return authenticate(u, p);
}
