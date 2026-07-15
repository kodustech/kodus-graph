export function authenticate(user: string, pass: string): boolean {
    return user.length > 0 && pass.length > 0;
}
