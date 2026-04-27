#pragma once
#include <string>
#include "user_repository.hpp"

namespace app {

class UserService {
public:
    UserService(UserRepository repo, std::string name);
    std::string get_name() const;
    std::string lookup(int id) const;
    size_t total_users() const;
    std::string greet() const;
    const char* classify(int count) const;

private:
    UserRepository repo_;
    std::string name_;
};

UserService make_service(std::string name);

} // namespace app
