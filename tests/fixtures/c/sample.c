#include <stdio.h>
#include <stdlib.h>
#include "utils.h"

typedef struct {
    char* name;
    int age;
} User;

struct Point {
    int x;
    int y;
};

enum Status { ACTIVE, INACTIVE };

void process_user(User* user) {
    if (!user) return;
    printf("Processing %s\n", user->name);
}

static int helper(int x) {
    return x * 2;
}

int add(int a, int b) {
    return a + b;
}
