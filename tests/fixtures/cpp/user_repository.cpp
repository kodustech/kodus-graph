#include "user_repository.hpp"

namespace app {

UserRepository::UserRepository() {}

std::string UserRepository::find(int id) const {
    auto it = users_.find(id);
    if (it != users_.end()) {
        return it->second;
    }
    return "";
}

void UserRepository::save(int id, const std::string& name) {
    users_[id] = name;
}

size_t UserRepository::count() const {
    return users_.size();
}

UserRepository build_default_repository() {
    UserRepository repo;
    repo.save(1, "alice");
    repo.save(2, "bob");
    return repo;
}

} // namespace app
