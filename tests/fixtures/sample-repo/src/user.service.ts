export class UserService {
  async getProfile(userId: number): Promise<Profile> {
    return { name: 'test' } as Profile;
  }
}
