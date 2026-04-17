package com.example

import com.example.models.User
import com.example.services.BaseService

interface Greetable {
    fun greet(): String
}

enum class Status {
    ACTIVE,
    INACTIVE
}

data class UserDto(val name: String, val email: String)

open class BaseService {
    open fun validate(): Boolean = true
}

class UserService(private val repo: Repository) : BaseService(), Greetable {
    private var name: String = ""

    fun getName(): String {
        return this.name
    }

    override fun greet(): String {
        return "Hello, ${getName()}"
    }

    fun createUser(dto: UserDto): User {
        validate()
        return User(dto.name, dto.email)
    }

    companion object {
        fun create(repo: Repository): UserService = UserService(repo)
    }
}

object SingletonHelper {
    fun doSomething(): String = "hello"
}

@Test
fun testGetName() {
    val svc = UserService(MockRepo())
    assert(svc.getName() == "test")
}

fun classify(x: Int): String {
    if (x > 0) {
        return "positive"
    } else if (x < 0) {
        return "negative"
    }
    return "zero"
}
