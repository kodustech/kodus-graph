"""Sample Python fixture for language-coverage CI gate."""


class UserRepository:
    def find_all(self) -> list:
        return []

    def save(self, user):
        return user


class Cache:
    def get(self, key: str):
        return None

    def set(self, key: str, value):
        pass


class UserService:
    repo: UserRepository

    def __init__(self, cache: Cache):
        self.cache = cache

    def list_users(self):
        cached = self.cache.get('users')
        if cached is not None:
            return cached
        users = self.repo.find_all()
        self.cache.set('users', users)
        return users

    def persist(self, user):
        saved = self.repo.save(user)
        self.cache.set('user:' + str(saved.id), saved)
        return saved


def classify(score: int) -> str:
    if score > 80:
        return 'high'
    elif score > 50:
        return 'medium'
    return 'low'
