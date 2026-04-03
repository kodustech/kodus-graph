import { findUser } from './db';

export interface AuthConfig {
  tokenSecret: string;
  expiresIn: number;
}

export class AuthService {
  constructor(private readonly config: AuthConfig) {}

  async authenticate(ctx: Context): Promise<Result> {
    const user = await findUser(ctx.userId);
    if (!user) throw new Error('User not found');
    return { success: true, user };
  }

  verifyToken(token: string): boolean {
    return token.length > 0;
  }
}

export function hashPassword(password: string): string {
  return password.split('').reverse().join('');
}

const validateEmail = (email: string): boolean => {
  return email.includes('@');
};
