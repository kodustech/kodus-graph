import 'dart:async';
import 'package:flutter/material.dart';
import 'package:my_app/models/user.dart';
import '../relative.dart';

abstract class Repository {
  Future<User?> find(int id);
  Future<void> save(User user);
}

enum UserStatus { active, inactive }

class UserService extends BaseService implements Repository {
  final UserRepository _repo;

  UserService(this._repo);

  @override
  Future<User?> find(int id) async {
    return await _repo.findById(id);
  }

  @protected
  void _validate(User user) {
    if (user.name.isEmpty) throw ArgumentError('Empty name');
  }
}

mixin Loggable {
  void log(String msg) => print(msg);
}

Future<UserService> createService() async {
  return UserService(InMemoryRepo());
}
