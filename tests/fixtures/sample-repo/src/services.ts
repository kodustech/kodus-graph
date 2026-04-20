import { AuthService, hashPassword } from './auth';
import { findUser, saveUser } from './db';
import { UserService } from './user.service';

export class AccountService {
    constructor(
        private readonly authService: AuthService,
        private readonly userService: UserService,
    ) {}

    async register(ctx: Context): Promise<Result> {
        const hashed = hashPassword(ctx.password);
        const existing = await findUser(ctx.userId);
        if (existing) {
            return { success: false };
        }
        await saveUser({ id: ctx.userId, password: hashed });
        return this.login(ctx);
    }

    async login(ctx: Context): Promise<Result> {
        const result = await this.authService.authenticate(ctx);
        await this.userService.getProfile(ctx.userId);
        return result;
    }

    async refresh(ctx: Context): Promise<Result> {
        const result = await this.login(ctx);
        await this.userService.getProfile(ctx.userId);
        return result;
    }
}

export async function bootstrap(ctx: Context): Promise<void> {
    await findUser(ctx.userId);
    await saveUser({ id: ctx.userId });
    hashPassword(ctx.password);
}
