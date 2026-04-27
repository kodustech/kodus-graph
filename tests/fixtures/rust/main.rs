use crate::user_repository::build_default_repository;
use crate::user_service::{UserService, make_service};

fn bootstrap() -> UserService {
    let repo = build_default_repository();
    UserService::new(repo, "admin".to_string())
}

fn run() {
    let svc = bootstrap();
    let greeting = svc.greet();
    println!("{}", greeting);

    let total = svc.total_users();
    let label = svc.classify(total as i32);
    println!("users: {} ({})", total, label);

    if let Some(name) = svc.lookup(1) {
        println!("found: {}", name);
    }
}

fn main() {
    run();

    let another = make_service("guest".to_string());
    let msg = another.greet();
    println!("{}", msg);
}
