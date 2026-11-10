package widgetdesignsvc

import (
	"context"
	"errors"
	"testing"
)

type store struct {
	id    *string
	err   error
	calls int
	ctx   context.Context
}

func (s *store) Get(ctx context.Context, _ string) (*string, error) {
	s.ctx = ctx
	return s.id, s.err
}
func (s *store) Put(ctx context.Context, _, _ string) error {
	s.ctx = ctx
	s.calls++
	return s.err
}

func TestWidgetDesignService(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	repo := &store{}
	service := New(repo)
	for _, invalid := range []string{"", "future", "CLASSIC", " v1"} {
		if err := service.Put(ctx, "scope", invalid); !errors.Is(err, ErrInvalidPack) {
			t.Fatalf("invalid pack admitted: %q %v", invalid, err)
		}
	}
	if repo.calls != 0 {
		t.Fatal("invalid packs reached repository")
	}
	for _, stored := range []string{"unknown", "classic", "v4", "memphis"} {
		repo.id = &stored
		got, err := service.Get(ctx, "scope")
		want := stored
		if stored == "unknown" {
			want = "classic"
		}
		if err != nil || got != want || repo.ctx != ctx {
			t.Fatalf("get %q: %q %v", stored, got, err)
		}
	}
	repo.id = nil
	if got, err := service.Get(ctx, "scope"); got != "classic" || err != nil {
		t.Fatal("absent preference did not resolve classic")
	}
	repo.err = context.Canceled
	if _, err := service.Get(ctx, "scope"); !errors.Is(err, context.Canceled) {
		t.Fatal("read error lost")
	}
	if err := service.Put(ctx, "scope", "v4"); !errors.Is(err, context.Canceled) {
		t.Fatal("write error lost")
	}
}
