package alertpacks

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/alertmsg"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

type Template struct {
	ID   string               `json:"id"`
	Unit string               `json:"unit"`
	Rule alertmodel.AlertRule `json:"rule"`
}

type Pack struct {
	ID          string     `json:"id"`
	Version     int        `json:"version"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Rules       []Template `json:"rules"`
}

type Selection struct {
	TemplateID string   `json:"template_id"`
	ValueNum   *float64 `json:"value_num,omitempty"`
	Message    *string  `json:"message,omitempty"`
	CooldownS  *int     `json:"cooldown_s,omitempty"`
}

type InstallRequest struct {
	Name        string      `json:"name,omitempty"`
	Version     int         `json:"version"`
	AllVehicles bool        `json:"all_vehicles"`
	VehicleIDs  []int64     `json:"vehicle_ids"`
	Enabled     bool        `json:"enabled"`
	Rules       []Selection `json:"rules"`
}

type Member struct {
	TemplateID string `json:"template_id"`
	RuleID     *int64 `json:"rule_id"`
	Name       string `json:"name"`
	Owned      bool   `json:"owned"`
	Enabled    bool   `json:"enabled"`
	Shared     bool   `json:"shared"`
}

type Installation struct {
	ID        int64     `json:"id"`
	PackID    string    `json:"pack_id"`
	Name      string    `json:"name"`
	Version   int       `json:"version"`
	ScopeKey  string    `json:"scope_key"`
	CreatedAt time.Time `json:"created_at"`
	Members   []Member  `json:"members"`
}

var (
	ErrInstalled = errors.New("this pack is already installed for these vehicles")
	ErrNotFound  = errors.New("pack installation not found")
	ErrSelection = errors.New("only rules created by this installation can be removed")
)

func ptr[T any](v T) *T { return &v }

func numeric(id, name, signal, op string, value float64, unit, severity, message string) Template {
	t := base(id, name, signal, op, severity, message)
	t.Unit, t.Rule.ValueNum = unit, ptr(value)
	return t
}

func state(id, name, signal, op, value, severity, message string) Template {
	t := base(id, name, signal, op, severity, message)
	if op != "changed" {
		t.Rule.ValueText = ptr(value)
	}
	return t
}

func boolean(id, name, signal string, value bool, severity, message string) Template {
	t := base(id, name, signal, "=", severity, message)
	t.Rule.ValueBool = ptr(value)
	return t
}

func base(id, name, signal, op, severity, message string) Template {
	return Template{ID: id, Rule: alertmodel.AlertRule{
		Name: name, SignalName: signal, Op: op, Severity: severity,
		CooldownMin: 60, TriggerMode: "once", Kind: "signal",
		AllVehicles: true, VehicleIDs: []int64{}, MsgTemplate: ptr(message), IncludeTitle: true,
	}}
}

// Catalog returns fresh values so install overrides cannot mutate later previews.
// Operands are canonical signal values, never copied from display-unit templates.
func Catalog() []Pack {
	low := numeric("battery-low", "Battery running low", "BatteryLevel", "<", 20, "%", "warn",
		"{{VehicleName}} is down to {{Value}}% battery. Time to put the next charge on the map.")
	critical := numeric("battery-critical", "Battery critically low", "BatteryLevel", "<", 10, "%", "critical",
		"{{VehicleName}} has {{Value}}% battery remaining. Plan a safe charging stop.")
	complete := state("charge-complete", "Charging complete", "DetailedChargeState", "=", "Complete", "info",
		"{{VehicleName}} has finished its charging chapter. Next stop: your choice.")
	charge := state("charge-started", "Charging started", "DetailedChargeState", "=", "Charging", "info",
		"{{VehicleName}} is taking an electricity break. Charging has started.")
	stop := state("charge-stopped", "Charging stopped", "DetailedChargeState", "=", "Stopped", "warn",
		"{{VehicleName}} reports charging stopped. If that was not planned, check the session.")
	unlocked := boolean("unlocked", "Vehicle unlocked", "Locked", false, "info",
		"{{VehicleName}} reports unlocked. A useful heads-up if you expected it to be locked.")
	pin := boolean("pin-disabled", "PIN to Drive disabled", "PinToDriveEnabled", false, "warn",
		"{{VehicleName}} reports PIN to Drive disabled. Check this setting if the change was unexpected.")
	hot := numeric("cabin-hot", "Cabin temperature high", "InsideTemp", ">", 40, "°C", "warn",
		"{{VehicleName}} reports a hot cabin. Check cabin conditions before getting in; never rely on this alert for occupant safety.")
	cold := numeric("cabin-cold", "Cabin below freezing", "InsideTemp", "<", 0, "°C", "info",
		"{{VehicleName}} has a frosty cabin. Consider preconditioning before your next departure.")
	update := state("software-version", "Software version changed", "Version", "changed", "", "info",
		"{{VehicleName}} has a new software chapter: {{Value}}. Take a look at the release notes.")
	return []Pack{
		{"everyday", 1, "Everyday essentials", "A low-noise starting set for battery, charging and software changes.", []Template{low, complete, update}},
		{"charging", 1, "Charging companion", "Follow charging state changes without assuming why a session stopped.", []Template{charge, stop, complete}},
		{"security", 1, "Security settings", "Stay aware of lock and access-setting changes. These are not intrusion detection or parked-only rules.", []Template{
			unlocked, pin, boolean("valet-enabled", "Valet mode enabled", "ValetModeEnabled", true, "info", "{{VehicleName}} reports Valet Mode enabled. The keys may be shared, but the settings are worth a glance."),
		}},
		{"trip", 1, "Road-trip companion", "Battery and charging reminders for longer journeys; no navigation or vehicle commands.", []Template{low, critical, charge, complete}},
		{"climate", 1, "Cabin comfort", "Temperature reminders, not a safety monitor. Vehicle telemetry may be delayed or unavailable.", []Template{hot, cold,
			boolean("preconditioning", "Preconditioning active", "PreconditioningEnabled", true, "info", "{{VehicleName}} is getting ready: preconditioning is active."),
		}},
		{"battery", 1, "Battery watch", "Battery thresholds and charge-limit changes with once-per-condition notifications.", []Template{low, critical,
			state("charge-limit", "Charge limit changed", "ChargeLimitSoc", "changed", "", "info", "{{VehicleName}} has a new charging target: {{Value}}%. Check that it suits your next journey."),
		}},
	}
}

func Find(id string) (Pack, bool) {
	if id == "custom" {
		return CustomCatalog(), true
	}
	for _, p := range Catalog() {
		if p.ID == id {
			return p, true
		}

	}
	return Pack{}, false
}

// CustomCatalog is shared by the manual composer and the Helix proposal tool.
func CustomCatalog() Pack {
	p := Pack{ID: "custom", Version: 1, Name: "Custom pack", Description: "Choose supported rules to build your own group.", Rules: []Template{}}
	seen := map[string]bool{}
	for _, pack := range Catalog() {
		for _, rule := range pack.Rules {
			if !seen[rule.ID] {
				seen[rule.ID] = true
				p.Rules = append(p.Rules, rule)
			}
		}
	}
	return p
}

func NameCustom(pack Pack, name string, templates []Template) (Pack, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 100 {
		return Pack{}, errors.New("custom pack name must contain 1 to 100 characters")
	}
	ids := make([]string, len(templates))
	for i, t := range templates {
		ids[i] = t.ID
	}
	slices.Sort(ids)
	digest := sha256.Sum256([]byte(strings.ToLower(name) + "\x00" + strings.Join(ids, "\x00")))
	pack.ID = fmt.Sprintf("custom-%x", digest[:16])
	pack.Name, pack.Rules = name, templates
	return pack, nil
}

func Prepare(pack Pack, req InstallRequest) ([]Template, string, error) {
	if req.Version != pack.Version {
		return nil, "", errors.New("pack version changed; refresh the preview")
	}
	if req.AllVehicles == (len(req.VehicleIDs) > 0) || len(req.VehicleIDs) > 100 {
		return nil, "", errors.New("select all vehicles or between 1 and 100 specific vehicles")
	}
	ids := slices.Clone(req.VehicleIDs)
	slices.Sort(ids)
	ids = slices.Compact(ids)
	scope := "all"
	if !req.AllVehicles {
		parts := make([]string, len(ids))
		for i, id := range ids {
			if id <= 0 {
				return nil, "", errors.New("vehicle IDs must be positive")
			}
			parts[i] = strconv.FormatInt(id, 10)
		}
		scope = strings.Join(parts, ",")
	}
	if len(req.Rules) == 0 || len(req.Rules) > len(pack.Rules) {
		return nil, "", errors.New("select at least one rule from this pack")
	}
	seen := map[string]bool{}
	out := make([]Template, 0, len(req.Rules))
	for _, selection := range req.Rules {
		index := slices.IndexFunc(pack.Rules, func(t Template) bool { return t.ID == selection.TemplateID })
		if index < 0 || seen[selection.TemplateID] {
			return nil, "", errors.New("unknown or duplicate template ID")
		}
		seen[selection.TemplateID] = true
		t := pack.Rules[index]
		t.Rule.AllVehicles, t.Rule.VehicleIDs, t.Rule.Enabled = req.AllVehicles, append([]int64{}, ids...), req.Enabled
		if selection.ValueNum != nil {
			if t.Rule.ValueNum == nil || math.IsNaN(*selection.ValueNum) || math.IsInf(*selection.ValueNum, 0) {
				return nil, "", errors.New("numeric threshold is not valid for this rule")
			}
			v := *selection.ValueNum
			if (t.Unit == "%" && (v < 0 || v > 100)) || (t.Unit == "°C" && (v < -100 || v > 100)) {
				return nil, "", errors.New("threshold is outside the supported range")
			}
			t.Rule.ValueNum = ptr(v)
		}
		if selection.Message != nil {
			message := strings.TrimSpace(*selection.Message)
			if message == "" || len([]rune(message)) > alertmsg.MaxTemplateLength {
				return nil, "", fmt.Errorf("message must contain 1 to %d characters", alertmsg.MaxTemplateLength)
			}
			t.Rule.MsgTemplate = ptr(message)
		}
		if selection.CooldownS != nil {
			if *selection.CooldownS < 60 || *selection.CooldownS > 604800 || *selection.CooldownS%60 != 0 {
				return nil, "", errors.New("cooldown must be whole minutes between 60 and 604800 seconds")
			}
			t.Rule.CooldownMin = *selection.CooldownS / 60
		}
		out = append(out, t)
	}
	return out, scope, nil
}
