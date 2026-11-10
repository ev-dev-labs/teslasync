package widgetdesignsvc

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain/widgetdesign"
)

type store struct {
	value *widgetdesign.Preference
	err   error
	calls int
	ctx   context.Context
}

func (s *store) Get(ctx context.Context, _ string) (*widgetdesign.Preference, error) {
	s.ctx = ctx
	return s.value, s.err
}
func (s *store) Put(ctx context.Context, _, id string, appWide *bool) (widgetdesign.Preference, error) {
	s.ctx = ctx
	s.calls++
	value := widgetdesign.Preference{PackID: id}
	if appWide != nil {
		value.AppWide = *appWide
	}
	return value, s.err
}

func TestWidgetDesignService(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	repo := &store{}
	service := New(repo)
	for _, invalid := range []string{"", "future", "CLASSIC", " v1"} {
		if _, err := service.Put(ctx, "scope", invalid, nil); !errors.Is(err, ErrInvalidPack) {
			t.Fatalf("invalid pack admitted: %q %v", invalid, err)
		}
	}
	if repo.calls != 0 {
		t.Fatal("invalid packs reached repository")
	}
	for _, stored := range []string{"unknown", "classic", "v4", "memphis"} {
		repo.value = &widgetdesign.Preference{PackID: stored, AppWide: true}
		got, err := service.Get(ctx, "scope")
		want := stored
		if stored == "unknown" {
			want = "classic"
		}
		if err != nil || got.PackID != want || got.AppWide != (stored != "unknown") || repo.ctx != ctx {
			t.Fatalf("get %q: %+v %v", stored, got, err)
		}
	}
	repo.value = nil
	if got, err := service.Get(ctx, "scope"); got.PackID != "classic" || got.AppWide || err != nil {
		t.Fatal("absent preference did not resolve classic")
	}
	repo.err = context.Canceled
	if _, err := service.Get(ctx, "scope"); !errors.Is(err, context.Canceled) {
		t.Fatal("read error lost")
	}
	if _, err := service.Put(ctx, "scope", "v4", nil); !errors.Is(err, context.Canceled) {
		t.Fatal("write error lost")
	}
}
