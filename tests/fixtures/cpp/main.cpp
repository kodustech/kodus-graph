#include <iostream>
#include "user_service.hpp"
#include "user_repository.hpp"

using namespace app;

UserService bootstrap() {
    UserRepository repo = build_default_repository();
    return UserService(repo, "admin");
}

void run() {
    UserService svc = bootstrap();
    std::string greeting = svc.greet();
    std::cout << greeting << std::endl;

    size_t total = svc.total_users();
    const char* label = svc.classify(static_cast<int>(total));
    std::cout << "users: " << total << " (" << label << ")" << std::endl;

    std::string found = svc.lookup(1);
    if (!found.empty()) {
        std::cout << "found: " << found << std::endl;
    }
}

int main() {
    run();

    UserService another = make_service("guest");
    std::string msg = another.greet();
    std::cout << msg << std::endl;

    return 0;
}
