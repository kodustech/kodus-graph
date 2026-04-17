use std::fmt;
use crate::utils::helper;

pub trait Greetable {
    fn greet(&self) -> String;
}

pub struct UserService {
    name: String,
}

pub enum Status {
    Active,
    Inactive,
}

impl UserService {
    pub fn new(name: String) -> Self {
        UserService { name }
    }

    pub fn get_name(&self) -> &str {
        &self.name
    }
}

impl fmt::Display for UserService {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.name)
    }
}

#[test]
fn test_new_user_service() {
    let svc = UserService::new("test".to_string());
    assert_eq!(svc.get_name(), "test");
}

pub fn classify(x: i32) -> &'static str {
    if x > 0 {
        "positive"
    } else if x < 0 {
        "negative"
    } else {
        "zero"
    }
}
