package chargeplanner

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// QueueVehicle is one car competing for a single shared charger.
type QueueVehicle struct {
	VehicleID          int64   `json:"vehicle_id"`
	CurrentSOC         float64 `json:"current_soc"`
	TargetSOC          float64 `json:"target_soc"`
	ReadyBy            string  `json:"ready_by"` // daily "HH:MM"
	BatteryCapacityKWh float64 `json:"battery_capacity_kwh"`
}

type queueAdviseRequest struct {
	Vehicles  []QueueVehicle `json:"vehicles"`
	ChargerKW float64        `json:"charger_kw"`
}

// QueueSlot is one ordered charging window.
type QueueSlot struct {
	VehicleID  int64     `json:"vehicle_id"`
	Position   int       `json:"position"`
	StartTime  time.Time `json:"start_time"`
	EndTime    time.Time `json:"end_time"`
	KWhNeeded  float64   `json:"kwh_needed"`
	ReadyBy    time.Time `json:"ready_by"`
	SlackHours float64   `json:"slack_hours"`
	Feasible   bool      `json:"feasible"`
}

// QueueAdvice is the POST /charge-planner/queue response.
type QueueAdvice struct {
	Slots       []QueueSlot `json:"slots"`
	AllFeasible bool        `json:"all_feasible"`
	Explanation string      `json:"explanation"`
}

// ComputeQueue orders vehicles least-slack-first and lays back-to-back
// windows from now. Slack = ready_by − (now + charge_time): the car with
// the least room for delay charges first. now pins the clock for tests.
func ComputeQueue(vehicles []QueueVehicle, chargerKW float64, now time.Time) (QueueAdvice, error) {
	if len(vehicles) == 0 || len(vehicles) > 8 {
		return QueueAdvice{}, fmt.Errorf("vehicles must list 1..8 entries")
	}
	if chargerKW < 1 || chargerKW > 22 {
		return QueueAdvice{}, fmt.Errorf("charger_kw must be 1..22")
	}
	type work struct {
		v     QueueVehicle
		kwh   float64
		hours float64
		ready time.Time
		slack float64
	}
	items := make([]work, 0, len(vehicles))
	seen := map[int64]bool{}
	for _, v := range vehicles {
		if v.VehicleID <= 0 || seen[v.VehicleID] {
			return QueueAdvice{}, fmt.Errorf("vehicle ids must be unique and positive")
		}
		seen[v.VehicleID] = true
		if v.CurrentSOC < 0 || v.CurrentSOC > 100 || v.TargetSOC <= 0 || v.TargetSOC > 100 {
			return QueueAdvice{}, fmt.Errorf("soc values must be 0..100")
		}
		if v.TargetSOC <= v.CurrentSOC {
			return QueueAdvice{}, fmt.Errorf("vehicle %d: target must exceed current soc", v.VehicleID)
		}
		capacity := v.BatteryCapacityKWh
		if capacity <= 0 {
			capacity = 75
		}
		h, m, err := parseClock(v.ReadyBy)
		if err != nil {
			return QueueAdvice{}, fmt.Errorf("vehicle %d: %w", v.VehicleID, err)
		}
		ready := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, now.Location())
		if !ready.After(now) {
			ready = ready.Add(24 * time.Hour)
		}
		kwh := (v.TargetSOC - v.CurrentSOC) / 100 * capacity
		hours := kwh * 1.10 / chargerKW // 10% charging loss, same as the planner
		items = append(items, work{v: v, kwh: kwh, hours: hours, ready: ready,
			slack: ready.Sub(now).Hours() - hours})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].slack != items[j].slack {
			return items[i].slack < items[j].slack
		}
		return items[i].v.VehicleID < items[j].v.VehicleID
	})

	advice := QueueAdvice{Slots: []QueueSlot{}, AllFeasible: true}
	cursor := now
	for i, it := range items {
		end := cursor.Add(time.Duration(it.hours * float64(time.Hour)))
		feasible := !end.After(it.ready)
		if !feasible {
			advice.AllFeasible = false
		}
		advice.Slots = append(advice.Slots, QueueSlot{
			VehicleID:  it.v.VehicleID,
			Position:   i + 1,
			StartTime:  cursor,
			EndTime:    end,
			KWhNeeded:  math.Round(it.kwh*10) / 10,
			ReadyBy:    it.ready,
			SlackHours: math.Round(it.slack*10) / 10,
			Feasible:   feasible,
		})
		cursor = end
	}
	if advice.AllFeasible {
		advice.Explanation = fmt.Sprintf(
			"Charge in order — every car finishes before its ready-by on the shared charger: %s.",
			slotList(advice.Slots))
	} else {
		advice.Explanation = "The queue overruns at least one ready-by — raise charger power, stagger ready-by times, or top up the tightest car elsewhere first."
	}
	return advice, nil
}

func parseClock(s string) (int, int, error) {
	var h, m int
	n, err := fmt.Sscanf(s, "%d:%d", &h, &m)
	if err != nil || n != 2 || h < 0 || h > 23 || m < 0 || m > 59 || len(s) != 5 {
		return 0, 0, fmt.Errorf("ready_by must be HH:MM (24h)")
	}
	return h, m, nil
}

func slotList(slots []QueueSlot) string {
	out := ""
	for i, s := range slots {
		if i > 0 {
			out += " → "
		}
		out += fmt.Sprintf("vehicle %d (%s–%s)", s.VehicleID,
			s.StartTime.Format("15:04"), s.EndTime.Format("15:04"))
	}
	return out
}

// Queue handles POST /charge-planner/queue.
func (h *Handler) Queue(w http.ResponseWriter, r *http.Request) {
	var req queueAdviseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	advice, err := ComputeQueue(req.Vehicles, req.ChargerKW, time.Now())
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, advice)
}
