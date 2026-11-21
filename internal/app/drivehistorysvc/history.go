package drivehistorysvc

import (
	"cmp"
	"encoding/json"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	drive "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
)

type Filters struct {
	Sort              string                    `json:"sort"`
	Direction         string                    `json:"direction"`
	Collection        string                    `json:"collection"`
	FSD               string                    `json:"fsd"`
	Status            string                    `json:"status"`
	Text              map[string]string         `json:"text"`
	Minimum           map[string]float64        `json:"minimum"`
	Grade             string                    `json:"grade"`
	Invalid           bool                      `json:"invalid"`
	Values            map[string]ValueSelection `json:"values"`
	Search            []SearchToken             `json:"search"`
	Locale            string                    `json:"locale"`
	Precision         int                       `json:"precision"`
	DistanceUnitScale float64                   `json:"distance_unit_scale"`
}

type SearchToken struct {
	Kind   string   `json:"kind"`
	Key    string   `json:"key"`
	Op     string   `json:"op"`
	Value  string   `json:"value"`
	Target *float64 `json:"target"`
}

type ValueSelection struct {
	Exclude bool              `json:"exclude"`
	Keys    []json.RawMessage `json:"keys"`
}

type FSDValue struct {
	Confidence string
	Distance   *float64
	Share      *float64
}

type Page struct {
	Items []*drive.Drive `json:"items"`
	Total int            `json:"total"`
	Page  int            `json:"page"`
}

type Facet struct {
	Value any `json:"value"`
	Count int `json:"count"`
}

func ValueField(key string) bool {
	switch key {
	case "route", "date", "start", "destination", "distance", "duration", "speed", "maxSpeed", "avgPower",
		"outsideTemp", "insideTemp", "efficiency", "startBattery", "battery", "batteryUsed", "energy",
		"regen", "fsd", "grade", "score", "cost", "status":
		return true
	default:
		return false
	}
}

func (f Filters) DefaultOrder() bool {
	return (f.Sort == "" || f.Sort == "date") && f.Direction != "asc" &&
		(f.Collection == "" || f.Collection == "all") && (f.FSD == "" || f.FSD == "all") &&
		(f.Status == "" || f.Status == "all") && len(f.Text) == 0 && len(f.Minimum) == 0 &&
		f.Grade == "" && !f.Invalid && len(f.Values) == 0 && len(f.Search) == 0
}

type Record struct {
	drive *drive.Drive
	fsd   FSDValue
}

func NewRecords(drives []*drive.Drive, fsd map[int64]FSDValue) []Record {
	rows := make([]Record, 0, len(drives))
	for _, d := range drives {
		rows = append(rows, Record{drive: d, fsd: fsd[d.ID]})
	}
	return rows
}

func (r Record) endpoint(start bool) any {
	address, lat, lon := r.drive.EndAddress, r.drive.EndLat, r.drive.EndLon
	if start {
		address, lat, lon = r.drive.StartAddress, r.drive.StartLat, r.drive.StartLon
	}
	if value := strings.TrimSpace(orEmpty(address)); value != "" {
		return value
	}
	if lat == nil || lon == nil {
		return nil
	}
	return coordinates{*lat, *lon}
}

type coordinates struct{ lat, lon float64 }

func coordinateLabel(value any, printer *message.Printer) string {
	switch value := value.(type) {
	case coordinates:
		return printer.Sprintf("📍 %.5f, %.5f", value.lat, value.lon)
	case string:
		return value
	default:
		return "—"
	}
}

func (r Record) text(key string, printer *message.Printer) any {
	switch key {
	case "start", "destination":
		value := r.endpoint(key == "start")
		if value != nil {
			return coordinateLabel(value, printer)
		}
	case "route":
		start, end := r.endpoint(true), r.endpoint(false)
		if start != nil || end != nil {
			return coordinateLabel(start, printer) + " → " + coordinateLabel(end, printer)
		}
	}
	return nil
}

func (r Record) efficiency() *float64 {
	d := r.drive
	if d.DistanceM < 1000 || !finite(d.DistanceM) || d.EnergyUsedWh == nil || *d.EnergyUsedWh <= 0 || !finite(*d.EnergyUsedWh) {
		return nil
	}
	return ptr(*d.EnergyUsedWh / (d.DistanceM / 1000))
}

func grade(value *float64) string {
	switch {
	case value == nil:
		return "—"
	case *value < 130:
		return "A+"
	case *value < 160:
		return "A"
	case *value < 190:
		return "B"
	case *value < 220:
		return "C"
	default:
		return "D"
	}
}

func (r Record) flags() []string {
	d := r.drive
	var flags []string
	if d.EndTs == nil {
		flags = append(flags, "inProgress")
	} else if d.DistanceM <= 0 && d.DurationS <= 0 {
		flags = append(flags, "noTelemetry")
	}
	if d.MaxSpeedMps != nil && *d.MaxSpeedMps > 58.1152 {
		flags = append(flags, "highSpeed")
	}
	if grade(r.efficiency()) == "D" {
		flags = append(flags, "highEnergyUse")
	}
	return flags
}

var statuses = []string{"recorded", "needsReview", "inProgress"}

func (r Record) status() string {
	if r.drive.EndTs == nil {
		return statuses[2]
	}
	if len(r.flags()) > 0 {
		return statuses[1]
	}
	return statuses[0]
}

func (r Record) number(key string) *float64 {
	d := r.drive
	switch key {
	case "distance":
		return &d.DistanceM
	case "duration":
		return ptr(float64(d.DurationS))
	case "speed":
		if d.AvgSpeedMps == nil && d.DurationS > 0 {
			return ptr(d.DistanceM / float64(d.DurationS))
		}
		return d.AvgSpeedMps
	case "maxSpeed":
		return d.MaxSpeedMps
	case "avgPower":
		return d.AvgPowerW
	case "outsideTemp":
		return d.OutsideTempAvgC
	case "insideTemp":
		return d.InsideTempAvgC
	case "efficiency", "grade":
		return r.efficiency()
	case "energy", "cost":
		return d.EnergyUsedWh
	case "regen":
		return d.RegenEnergyWh
	case "score":
		return d.Score
	case "status":
		return ptr(float64(slices.Index(statuses, r.status())))
	case "startBattery", "battery", "batteryUsed":
		start, end := d.StartBatteryPct, d.EndBatteryPct
		if start != nil && end != nil && *start == 0 && *end == 0 && d.EndTs != nil {
			return nil
		}
		if key == "batteryUsed" && start != nil && end != nil {
			return ptr(float64(*start - *end))
		}
		if key == "startBattery" && start != nil {
			return ptr(float64(*start))
		}
		if key == "battery" && end != nil {
			return ptr(float64(*end))
		}
	}
	return nil
}

func (r Record) value(key string, printer *message.Printer) any {
	switch key {
	case "route", "start", "destination":
		return r.text(key, printer)
	case "date":
		return r.drive.StartTs.Format(time.RFC3339Nano)
	case "status":
		if flags := r.flags(); len(flags) > 0 {
			return strings.Join(flags, "|")
		}
		return nil
	case "grade":
		if label := grade(r.efficiency()); label != "—" {
			return label
		}
		return nil
	case "fsd":
		if r.fsd.Confidence != "unknown" && r.fsd.Distance != nil {
			if r.fsd.Share != nil {
				return "share:" + strconv.FormatFloat(*r.fsd.Share, 'f', -1, 64)
			}
			return "distance:" + strconv.FormatFloat(*r.fsd.Distance, 'f', -1, 64)
		}
		return nil
	default:
		value := r.number(key)
		if value == nil || !finite(*value) || (*value <= 0 && (key == "distance" || key == "energy" || key == "cost")) {
			return nil
		}
		return *value
	}
}

func Facets(rows []Record, field string, locale language.Tag) []Facet {
	result := []Facet{}
	index := make(map[any]int)
	printer := message.NewPrinter(locale)
	for _, row := range rows {
		value := row.value(field, printer)
		if i, ok := index[value]; ok {
			result[i].Count++
		} else {
			index[value] = len(result)
			result = append(result, Facet{Value: value, Count: 1})
		}
	}
	return result
}

type collections struct {
	notable  map[int64]bool
	commutes map[routePair]int
}

type routePair struct{ first, last string }

func (r Record) routePair() routePair {
	first := strings.Join(strings.Fields(strings.ToLower(orEmpty(r.drive.StartAddress))), " ")
	last := strings.Join(strings.Fields(strings.ToLower(orEmpty(r.drive.EndAddress))), " ")
	if first > last {
		first, last = last, first
	}
	return routePair{first, last}
}

func collect(rows []Record) collections {
	result := collections{make(map[int64]bool), make(map[routePair]int)}
	for _, row := range rows {
		if pair := row.routePair(); pair.first != "" {
			result.commutes[pair]++
		}
	}
	sorted := slices.Clone(rows)
	slices.SortStableFunc(sorted, func(a, b Record) int { return cmp.Compare(b.drive.DistanceM, a.drive.DistanceM) })
	for _, row := range sorted[:min(50, (len(sorted)+9)/10)] {
		result.notable[row.drive.ID] = true
	}
	return result
}

func (c collections) matches(row Record, collection string) bool {
	switch collection {
	case "anomalies":
		return grade(row.efficiency()) == "D"
	case "notable":
		return c.notable[row.drive.ID] || grade(row.efficiency()) == "A+"
	case "commutes":
		return c.commutes[row.routePair()] >= 3
	case "tagged":
		return false
	default:
		return true
	}
}

func matchesFSD(value FSDValue, filter string) bool {
	switch filter {
	case "", "all":
		return true
	case "reported":
		return value.Confidence != "unknown" && value.Distance != nil
	default:
		return value.Confidence == filter
	}
}

func (f Filters) Match(rows []Record, zone *time.Location, locale language.Tag) []Record {
	result := []Record{}
	if f.Invalid {
		return result
	}
	printer := message.NewPrinter(locale)
	var groups collections
	if f.Collection == "notable" || f.Collection == "commutes" {
		groups = collect(rows)
	}
	values := make(map[string]map[any]bool, len(f.Values))
	for field, selection := range f.Values {
		members := make(map[any]bool, len(selection.Keys))
		for _, key := range selection.Keys {
			var value any
			if json.Unmarshal(key, &value) != nil {
				return result
			}
			switch value.(type) {
			case string, float64, bool, nil:
				members[value] = true
			default:
				return result
			}
		}
		values[field] = members
	}
	for _, row := range rows {
		if !groups.matches(row, f.Collection) || !matchesFSD(row.fsd, f.FSD) ||
			(f.Status != "" && f.Status != "all" && f.Status != row.status()) ||
			(f.Grade != "" && f.Grade != grade(row.efficiency())) {
			continue
		}
		if f.matchesColumns(row, zone, printer, values) && f.matchesSearch(row, zone, printer) {
			result = append(result, row)
		}
	}
	return result
}

func (f Filters) matchesColumns(row Record, zone *time.Location, printer *message.Printer, values map[string]map[any]bool) bool {
	for field, keys := range values {
		if keys[row.value(field, printer)] == f.Values[field].Exclude {
			return false
		}
	}
	for field, minimum := range f.Minimum {
		if actual := row.number(field); actual == nil || !finite(*actual) || *actual < minimum {
			return false
		}
	}
	for field, target := range f.Text {
		if target == "" {
			continue
		}
		if field == "date" {
			if !dateContains(row.drive.StartTs.In(zone), target) {
				return false
			}
		} else if label, _ := row.text(field, printer).(string); !containsFold(label, target) {
			return false
		}
	}
	return true
}

func (f Filters) matchesSearch(row Record, zone *time.Location, printer *message.Printer) bool {
	if len(f.Search) == 0 {
		return true
	}
	label := grade(row.efficiency())
	fields := []string{orEmpty(row.drive.StartAddress), orEmpty(row.drive.EndAddress), label,
		printer.Sprintf("%.*f", min(max(f.Precision, 0), 8), row.drive.DistanceM*f.DistanceUnitScale)}
	for _, token := range f.Search {
		literal := token.Value
		if token.Kind == "kv" {
			switch token.Key {
			case "score", "grade":
				if !strings.EqualFold(label, strings.TrimSpace(token.Value)) {
					return false
				}
				continue
			case "from":
				if !dateContains(row.drive.StartTs.In(zone), strings.TrimSpace(token.Value)) {
					return false
				}
				continue
			case "distance":
				if token.Target != nil {
					if !compareNumber(row.drive.DistanceM, token.Op, *token.Target, f.DistanceUnitScale) {
						return false
					}
					continue
				}
			}
			literal = token.Key + ":" + token.Value
		}
		if !slices.ContainsFunc(fields, func(field string) bool { return containsFold(field, literal) }) {
			return false
		}
	}
	return true
}

func dateContains(at time.Time, target string) bool {
	for _, layout := range []string{"2006-01-02T15:04", "Jan 2, 2006, 03:04 PM", "January 2, 2006", "2 Jan 2006, 15:04"} {
		if containsFold(at.Format(layout), target) {
			return true
		}
	}
	return false
}

func containsFold(value, target string) bool {
	return strings.Contains(strings.ToLower(value), strings.ToLower(target))
}

func compareNumber(value float64, op string, target, scale float64) bool {
	switch op {
	case ">":
		return value > target
	case ">=":
		return value >= target
	case "<":
		return value < target
	case "<=":
		return value <= target
	default:
		return math.Abs((value-target)*scale) < 1e-9
	}
}

func (f Filters) Paginate(rows []Record, locale language.Tag, limit, offset int) Page {
	direction := -1
	if f.Direction == "asc" {
		direction = 1
	}
	if f.Sort != "date" && f.Sort != "" || direction == 1 {
		order := collate.New(locale, collate.Numeric)
		printer := message.NewPrinter(locale)
		slices.SortStableFunc(rows, func(a, b Record) int {
			switch f.Sort {
			case "route", "start", "destination":
				left, _ := a.text(f.Sort, printer).(string)
				right, _ := b.text(f.Sort, printer).(string)
				if left == "" || right == "" {
					return compareMissing(left == "", right == "")
				}
				return order.CompareString(left, right) * direction
			case "date", "":
				return a.drive.StartTs.Compare(b.drive.StartTs) * direction
			case "fsd":
				if result := compareOptional(a.fsd.Share, b.fsd.Share, direction); result != 0 {
					return result
				}
				return compareOptional(a.fsd.Distance, b.fsd.Distance, direction)
			default:
				return compareOptional(a.number(f.Sort), b.number(f.Sort), direction)
			}
		})
	}
	start := PageOffset(len(rows), limit, offset)
	items := make([]*drive.Drive, 0, min(limit, len(rows)-start))
	for _, row := range rows[start:min(len(rows), start+limit)] {
		items = append(items, row.drive)
	}
	return Page{Items: items, Total: len(rows), Page: start/limit + 1}
}

func PageOffset(total, limit, offset int) int {
	return min(offset/limit, max(0, (total-1)/limit)) * limit
}

func IDs(rows []Record) []int64 {
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.drive.ID)
	}
	return ids
}

func compareMissing(left, right bool) int {
	if left == right {
		return 0
	}
	if left {
		return 1
	}
	return -1
}

func compareOptional(a, b *float64, direction int) int {
	if a == nil || b == nil {
		return compareMissing(a == nil, b == nil)
	}
	return cmp.Compare(*a, *b) * direction
}

func orEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func ptr(value float64) *float64 { return &value }
