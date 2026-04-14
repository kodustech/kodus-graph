#ifndef SAMPLE_H
#define SAMPLE_H

#include "types.h"

typedef struct {
    int id;
    char* label;
} Widget;

enum Color { RED, GREEN, BLUE };

void process_user(User* user);
int add(int a, int b);

extern void exported_func(void);

#endif
