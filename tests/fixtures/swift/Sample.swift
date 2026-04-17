import Foundation
import UIKit

protocol Repository {
    func find(id: Int) -> User?
    func save(user: User)
}

@objc
open class UserService: BaseService, Repository {
    private let repo: UserRepository

    init(repo: UserRepository) {
        self.repo = repo
    }

    @discardableResult
    public func getUser(id: Int) async throws -> User {
        return try await repo.find(id: id)
    }

    internal func validate(_ user: User) -> Bool {
        return !user.name.isEmpty
    }
}

enum UserStatus {
    case active
    case inactive
}

struct UserDTO {
    let name: String
    let email: String
}

func createService() -> UserService {
    return UserService(repo: InMemoryRepo())
}

func classify(x: Int) -> String {
    if x > 0 {
        return "positive"
    } else if x < 0 {
        return "negative"
    }
    return "zero"
}
