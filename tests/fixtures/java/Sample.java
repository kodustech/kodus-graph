package com.example;

import java.util.List;
import java.util.ArrayList;

public interface Greetable {
    String greet();
}

public enum Status {
    ACTIVE,
    INACTIVE
}

public class UserService extends BaseService implements Greetable {
    private String name;

    public UserService(String name) {
        this.name = name;
    }

    public String getName() {
        return this.name;
    }

    @Override
    public String greet() {
        return "Hello, " + getName();
    }

    @Test
    public void testGetName() {
        UserService svc = new UserService("test");
        assert svc.getName().equals("test");
    }
}
