package sample

import (
	"fmt"
	"net/http"
)

type UserService struct {
	Name string
	Age  int
}

type Logger interface {
	Log(msg string)
	Error(msg string)
}

func NewUserService(name string) *UserService {
	return &UserService{Name: name}
}

func (s *UserService) GetName() string {
	fmt.Println(s.Name)
	return s.Name
}

func handleRequest(w http.ResponseWriter, r *http.Request) {
	svc := NewUserService("test")
	svc.GetName()
}

func classify(x int) string {
	if x > 0 {
		return "positive"
	}
	if x < 0 {
		return "negative"
	}
	return "zero"
}
