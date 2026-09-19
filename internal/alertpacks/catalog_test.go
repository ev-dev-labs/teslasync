package alertpacks

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

func TestCatalog(t *testing.T) {
	seen := map[string]bool{}
	templates := map[string]Template{}
	for _, p := range Catalog() {
		if seen[p.ID] || p.Version < 1 || len(p.Rules) < 2 || p.Name == "" || p.Description == "" {
			t.Fatalf("invalid pack: %+v", p)
		}
		seen[p.ID] = true
		for _, rule := range p.Rules {
			if _, err := protomodel.ParseField(rule.Rule.SignalName); err != nil {
				t.Fatalf("unknown catalog signal %s: %v", rule.Rule.SignalName, err)
			}
			if prior, ok := templates[rule.ID]; ok && !reflect.DeepEqual(prior, rule) {
				t.Fatalf("template %s differs across packs", rule.ID)
			}
			templates[rule.ID] = rule
			if rule.Rule.Enabled || rule.Rule.TriggerMode != "once" || rule.Rule.CooldownMin < 15 {
				t.Fatalf("unsafe/noisy defaults: %+v", rule)
			}
		}
	}
	if len(CustomCatalog().Rules) != len(templates) {
		t.Fatal("custom catalog must deduplicate shared templates")
	}
	if _, ok := Find("missing"); ok {
		t.Fatal("unknown pack found")
	}
	if _, ok := Find("custom"); !ok {
		t.Fatal("custom catalog missing")
	}
}

func validRequest() InstallRequest {
	return InstallRequest{Version: 2, AllVehicles: true, Rules: []Selection{{TemplateID: "battery-low"}}}
}

func TestPrepareInlineOperatorsAndChannels(t *testing.T) {
	pack := CustomCatalog()
	for _, tt := range []struct {
		template, op string
		valid        bool
	}{
		{"battery-low", ">=", true}, {"battery-low", "!=", true},
		{"battery-low", "between", false}, {"battery-low", "changed", false},
		{"charge-complete", "!=", true}, {"charge-complete", ">", false},
		{"unlocked", "=", true}, {"unlocked", "<", false},
		{"software-version", "changed", true}, {"software-version", "=", false},
	} {
		t.Run(tt.template+tt.op, func(t *testing.T) {
			req := validRequest()
			req.Rules = []Selection{{TemplateID: tt.template, Op: &tt.op, ChannelIDs: []int64{2, 3}}}
			out, _, err := Prepare(pack, req)
			if (err == nil) != tt.valid {
				t.Fatalf("valid=%v err=%v", tt.valid, err)
			}
			if err != nil {
				return
			}
			if out[0].Rule.Op != tt.op || !reflect.DeepEqual(out[0].Rule.ChannelIDs, []int64{2, 3}) {
				t.Fatal("inline overrides lost")
			}
			out[0].Rule.ChannelIDs[0] = 99
			if req.Rules[0].ChannelIDs[0] != 2 {
				t.Fatal("request channel slice was aliased")
			}
		})
	}
	for _, ids := range [][]int64{nil, {}} {
		req := validRequest()
		req.Rules[0].ChannelIDs = ids
		body, err := json.Marshal(req)
		if err != nil {
			t.Fatal(err)
		}
		var decoded InstallRequest
		if err := json.Unmarshal(body, &decoded); err != nil {
			t.Fatal(err)
		}
		out, _, err := Prepare(pack, decoded)
		if err != nil || (out[0].Rule.ChannelIDs == nil) != (ids == nil) {
			t.Fatalf("all/none channel semantics lost: %s (%v)", body, err)
		}
	}
}

func TestPrepare(t *testing.T) {
	pack, _ := Find("everyday")
	before, _ := json.Marshal(pack)
	req := validRequest()
	req.AllVehicles = false
	req.VehicleIDs = []int64{2, 1, 2}
	req.Rules[0].ValueNum = ptr(25.0)
	req.Rules[0].CooldownS = ptr(7200)
	req.Rules[0].Message = ptr(" {{VehicleName}} needs a charge. ")
	got, scope, err := Prepare(pack, req)
	if err != nil {
		t.Fatal(err)
	}
	if scope != "1,2" || !reflect.DeepEqual(got[0].Rule.VehicleIDs, []int64{1, 2}) || *got[0].Rule.ValueNum != 25 || got[0].Rule.CooldownMin != 120 || *got[0].Rule.MsgTemplate != "{{VehicleName}} needs a charge." {
		t.Fatalf("incorrect normalization: scope=%s rules=%+v", scope, got)
	}
	after, _ := json.Marshal(pack)
	if string(before) != string(after) {
		t.Fatal("prepare mutated catalog")
	}
}

func TestPrepareRejectsInvalidRequests(t *testing.T) {
	pack, _ := Find("everyday")
	tests := map[string]func(*InstallRequest){
		"version":                 func(r *InstallRequest) { r.Version = 99 },
		"empty":                   func(r *InstallRequest) { r.Rules = nil },
		"unknown":                 func(r *InstallRequest) { r.Rules[0].TemplateID = "invented" },
		"duplicate":               func(r *InstallRequest) { r.Rules = append(r.Rules, r.Rules[0]) },
		"scope conflict":          func(r *InstallRequest) { r.VehicleIDs = []int64{1} },
		"empty scope":             func(r *InstallRequest) { r.AllVehicles = false },
		"negative ID":             func(r *InstallRequest) { r.AllVehicles = false; r.VehicleIDs = []int64{-1} },
		"nan":                     func(r *InstallRequest) { r.Rules[0].ValueNum = ptr(math.NaN()) },
		"infinity":                func(r *InstallRequest) { r.Rules[0].ValueNum = ptr(math.Inf(1)) },
		"range":                   func(r *InstallRequest) { r.Rules[0].ValueNum = ptr(101.0) },
		"negative percent":        func(r *InstallRequest) { r.Rules[0].ValueNum = ptr(-1.0) },
		"text threshold":          func(r *InstallRequest) { r.Rules[0] = Selection{TemplateID: "charge-complete", ValueNum: ptr(3.0)} },
		"blank message":           func(r *InstallRequest) { r.Rules[0].Message = ptr("  ") },
		"long message":            func(r *InstallRequest) { r.Rules[0].Message = ptr(strings.Repeat("a", 1025)) },
		"cooldown zero":           func(r *InstallRequest) { r.Rules[0].CooldownS = ptr(0) },
		"cooldown huge":           func(r *InstallRequest) { r.Rules[0].CooldownS = ptr(604801) },
		"cooldown partial minute": func(r *InstallRequest) { r.Rules[0].CooldownS = ptr(61) },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			r := validRequest()
			mutate(&r)
			if _, _, err := Prepare(pack, r); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
}

func TestCustomIdentity(t *testing.T) {
	catalog := CustomCatalog()
	rules := catalog.Rules[:2]
	a, err := NameCustom(catalog, "  Weekend  ", rules)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("comprehensive catalog and delivery overrides", func(t *testing.T) {
		all, ok := Find("all")
		if !ok || len(all.Rules) < 60 {
			t.Fatalf("comprehensive pack is too thin: %d", len(all.Rules))
		}
		if len(Catalog()) < 14 {
			t.Fatal("focused pack coverage regressed")
		}
		ids := map[string]bool{}
		for _, rule := range all.Rules {
			if ids[rule.ID] {
				t.Fatalf("duplicate all-pack rule %s", rule.ID)
			}
			ids[rule.ID] = true
		}
		for _, pack := range Catalog() {
			if len(pack.Rules) < 5 {
				t.Fatalf("pack %s is too thin", pack.ID)
			}
			for _, rule := range pack.Rules {
				if !ids[rule.ID] {
					t.Fatalf("%s missing from all pack", rule.ID)
				}
			}
		}
		req := InstallRequest{Version: all.Version, AllVehicles: true, CooldownS: ptr(900), TriggerMode: ptr("repeat"), IncludeTitle: ptr(false),
			Rules: []Selection{{TemplateID: "battery-low"}, {TemplateID: "charge-complete", CooldownS: ptr(7200), TriggerMode: ptr("once"), IncludeTitle: ptr(true)}}}
		got, _, err := Prepare(all, req)
		if err != nil {
			t.Fatal(err)
		}
		if got[0].Rule.CooldownMin != 15 || got[0].Rule.TriggerMode != "repeat" || got[0].Rule.IncludeTitle {
			t.Fatal("master defaults not applied")
		}
		if got[1].Rule.CooldownMin != 120 || got[1].Rule.TriggerMode != "once" || !got[1].Rule.IncludeTitle {
			t.Fatal("individual settings did not override master")
		}
		for _, mutate := range []func(*InstallRequest){
			func(r *InstallRequest) { r.TriggerMode = ptr("invalid") },
			func(r *InstallRequest) { r.Rules[0].TriggerMode = ptr("") },
			func(r *InstallRequest) { r.CooldownS = ptr(61) },
			func(r *InstallRequest) { r.CooldownS = ptr(0) },
			func(r *InstallRequest) { r.Rules[0].CooldownS = ptr(604860) },
		} {
			bad := req
			bad.Rules = append([]Selection{}, req.Rules...)
			mutate(&bad)
			if _, _, err := Prepare(all, bad); err == nil {
				t.Fatal("invalid delivery settings accepted")
			}
		}
	})
	b, _ := NameCustom(catalog, "weekend", []Template{rules[1], rules[0]})
	if a.ID != b.ID || a.Name != "Weekend" {
		t.Fatal("identity depends on case/order/whitespace")
	}
	for _, name := range []string{" ", strings.Repeat("x", 101)} {
		if _, err := NameCustom(catalog, name, rules); err == nil {
			t.Fatal("invalid name accepted")
		}
	}
}
