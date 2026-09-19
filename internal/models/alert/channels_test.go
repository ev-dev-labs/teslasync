package alert

import (
	"encoding/json"
	"testing"
)

func TestChannelRouting(t *testing.T) {
	for _, tt := range []struct {
		name string
		rule *AlertRule
		id   int64
		want bool
	}{
		{"nil rule", nil, 1, false},
		{"legacy all", &AlertRule{}, 1, true},
		{"future channel", &AlertRule{}, 99, true},
		{"no external", &AlertRule{ChannelIDs: []int64{}}, 1, false},
		{"included", &AlertRule{ChannelIDs: []int64{2, 3}}, 2, true},
		{"excluded", &AlertRule{ChannelIDs: []int64{2, 3}}, 1, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.rule.DeliversToChannel(tt.id); got != tt.want {
				t.Fatalf("got %v want %v", got, tt.want)
			}
		})
	}
	for _, ids := range [][]int64{nil, {}, {2}} {
		data, err := json.Marshal(AlertRule{ChannelIDs: ids})
		if err != nil {
			t.Fatal(err)
		}
		var decoded AlertRule
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatal(err)
		}
		if (decoded.ChannelIDs == nil) != (ids == nil) || len(decoded.ChannelIDs) != len(ids) {
			t.Fatal("wire lost all/none distinction")
		}
	}
}
