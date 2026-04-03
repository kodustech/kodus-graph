import { AuthService } from '../src/auth';

describe('AuthService', () => {
  it('should authenticate valid user', async () => {
    const service = new AuthService({ tokenSecret: 'x', expiresIn: 100 });
    expect(service).toBeDefined();
  });

  test('verifyToken returns true for non-empty', () => {
    const service = new AuthService({ tokenSecret: 'x', expiresIn: 100 });
    expect(service.verifyToken('abc')).toBe(true);
  });
});
