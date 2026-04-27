#include "user_service.hpp"

namespace app {

UserService::UserService(UserRepository repo, std::string name)
    : repo_(repo), name_(name) {}

std::string UserService::get_name() const {
    return name_;
}

std::string UserService::lookup(int id) const {
    return repo_.find(id);
}

size_t UserService::total_users() const {
    return repo_.count();
}

std::string UserService::greet() const {
    return "Hello, " + get_name();
}

const char* UserService::classify(int count) const {
    if (count > 10) {
        return "many";
    } else if (count > 0) {
        return "few";
    }
    return "none";
}

UserService make_service(std::string name) {
    UserRepository repo;
    return UserService(repo, name);
}

} // namespace app
