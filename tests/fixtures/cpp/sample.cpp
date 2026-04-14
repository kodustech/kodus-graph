#include <string>
#include <vector>
#include "models/user.h"

namespace app {

class UserService : public BaseService, public IRepository {
public:
    UserService(Repository* repo) : repo_(repo) {}

    virtual User* getUser(int id) override {
        return repo_->find(id);
    }

private:
    void validate(const User& user) {
        if (user.name.empty()) throw std::invalid_argument("empty");
    }

    Repository* repo_;
};

template<typename T>
class Container {
public:
    void add(T item);
};

enum class Direction { North, South, East, West };

struct Point {
    int x;
    int y;
};

} // namespace app

void standalone_function(int x) {
    // free function outside namespace
}

static void internal_helper() {
    // static = not exported
}
