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
	return InstallRequest{Version: 1, AllVehicles: true, Rules: []Selection{{TemplateID: "battery-low"}}}
}

func TestPrepare(t *testing.T) {
	pack, _ := Find("everyday")
	before, _ := json.Marshal(pack)
	req := validRequest()
	req.AllVehicles = false
	req.VehicleIDs = []int64{2, 1, 2}
	req.Rules[0].ValueNum = ptr(25.0)
	req.Rules[0].CooldownMin = ptr(120)
	req.Rules[0].Message = ptr(" {{VehicleName}} needs a charge. ")
	got, scope, err := Prepare(pack, req)
	if err != nil {
		t.Fatal(err)
	}
	if scope != "1,2" || !reflect.DeepEqual(got[0].Rule.VehicleIDs, []int64{1, 2}) || *got[0].Rule.ValueNum != 25 || *got[0].Rule.MsgTemplate != "{{VehicleName}} needs a charge." {
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
		"version":          func(r *InstallRequest) { r.Version = 99 },
		"empty":            func(r *InstallRequest) { r.Rules = nil },
		"unknown":          func(r *InstallRequest) { r.Rules[0].TemplateID = "invented" },
		"duplicate":        func(r *InstallRequest) { r.Rules = append(r.Rules, r.Rules[0]) },
		"scope conflict":   func(r *InstallRequest) { r.VehicleIDs = []int64{1} },
		"empty scope":      func(r *InstallRequest) { r.AllVehicles = false },
		"negative ID":      func(r *InstallRequest) { r.AllVehicles = false; r.VehicleIDs = []int64{-1} },
		"nan":              func(r *InstallRequest) { r.Rules[0].ValueNum = ptr(math.NaN()) },
		"infinity":         func(r *InstallRequest) { r.Rules[0].ValueNum = ptr(math.Inf(1)) },
		"range":            func(r *InstallRequest) { r.Rules[0].ValueNum = ptr(101.0) },
		"negative percent": func(r *InstallRequest) { r.Rules[0].ValueNum = ptr(-1.0) },
		"text threshold":   func(r *InstallRequest) { r.Rules[0] = Selection{TemplateID: "charge-complete", ValueNum: ptr(3.0)} },
		"blank message":    func(r *InstallRequest) { r.Rules[0].Message = ptr("  ") },
		"long message":     func(r *InstallRequest) { r.Rules[0].Message = ptr(strings.Repeat("a", 1025)) },
		"cooldown zero":    func(r *InstallRequest) { r.Rules[0].CooldownMin = ptr(0) },
		"cooldown huge":    func(r *InstallRequest) { r.Rules[0].CooldownMin = ptr(10081) },
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
