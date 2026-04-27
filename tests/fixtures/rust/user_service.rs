use crate::user_repository::UserRepository;

pub struct UserService {
    repo: UserRepository,
    name: String,
}

impl UserService {
    pub fn new(repo: UserRepository, name: String) -> Self {
        UserService { repo, name }
    }

    pub fn get_name(&self) -> &str {
        &self.name
    }

    pub fn lookup(&self, id: u32) -> Option<String> {
        self.repo.find(id).cloned()
    }

    pub fn total_users(&self) -> usize {
        self.repo.count()
    }

    pub fn greet(&self) -> String {
        format!("Hello, {}", self.get_name())
    }

    pub fn classify(&self, count: i32) -> &'static str {
        if count > 10 {
            "many"
        } else if count > 0 {
            "few"
        } else {
            "none"
        }
    }
}

pub fn make_service(name: String) -> UserService {
    let repo = UserRepository::new();
    UserService::new(repo, name)
}
