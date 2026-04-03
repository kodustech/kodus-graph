import { AuthService } from './auth';
import { UserService } from './user.service';

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  async login(req: Request): Promise<Response> {
    const result = await this.authService.authenticate(req.ctx);
    return new Response(JSON.stringify(result));
  }
}
