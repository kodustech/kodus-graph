#ifndef SAMPLE_HPP
#define SAMPLE_HPP

#include <memory>
#include "base.h"

class Shape {
public:
    virtual double area() const = 0;
    virtual ~Shape() = default;
};

class Circle : public Shape {
public:
    Circle(double r) : radius_(r) {}
    double area() const override;
private:
    double radius_;
};

struct Config {
    int width;
    int height;
};

#endif
