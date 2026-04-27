#pragma once
#include <string>
#include <map>

namespace app {

class UserRepository {
public:
    UserRepository();
    std::string find(int id) const;
    void save(int id, const std::string& name);
    size_t count() const;

private:
    std::map<int, std::string> users_;
};

} // namespace app
