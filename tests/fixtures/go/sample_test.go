package sample

import "testing"

func TestNewUserService(t *testing.T) {
	svc := NewUserService("test")
	if svc.Name != "test" {
		t.Errorf("expected test, got %s", svc.Name)
	}
}

func BenchmarkGetName(b *testing.B) {
	svc := NewUserService("bench")
	for i := 0; i < b.N; i++ {
		svc.GetName()
	}
}
