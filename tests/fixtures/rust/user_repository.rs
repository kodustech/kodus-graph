use std::collections::HashMap;

pub struct UserRepository {
    users: HashMap<u32, String>,
}

impl UserRepository {
    pub fn new() -> Self {
        UserRepository {
            users: HashMap::new(),
        }
    }

    pub fn find(&self, id: u32) -> Option<&String> {
        self.users.get(&id)
    }

    pub fn save(&mut self, id: u32, name: String) {
        self.users.insert(id, name);
    }

    pub fn count(&self) -> usize {
        self.users.len()
    }
}

pub fn build_default_repository() -> UserRepository {
    let mut repo = UserRepository::new();
    repo.save(1, "alice".to_string());
    repo.save(2, "bob".to_string());
    repo
}
