package teslaphysics

import (
	"sort"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// BuildGearTheater keeps Tesla shift and charge-port language for one drive.
func BuildGearTheater(driveID, vehicleID int64, samples []TheaterSample) GearTheater {
	out := GearTheater{
		DriveID:   driveID,
		VehicleID: vehicleID,
		Events:    make([]TheaterEvent, 0),
		Honesty:   theaterHonesty,
	}
	ordered := append([]TheaterSample(nil), samples...)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].At.Before(ordered[j].At)
	})
	var last TheaterEvent
	started := false
	for _, sample := range ordered {
		event := TheaterEvent{
			At:                 sample.At.UTC(),
			Gear:               normalizeGear(sample.Gear),
			ChargePortDoorOpen: sample.ChargePortDoorOpen,
			ChargePortLatch:    sample.ChargePortLatch,
		}
		if !started {
			if event.Gear == "" && event.ChargePortLatch == "" && event.ChargePortDoorOpen == nil {
				continue
			}
			out.Events = append(out.Events, event)
			last = event
			started = true
			continue
		}
		gearChanged := event.Gear != "" && event.Gear != last.Gear
		latchChanged := event.ChargePortLatch != "" && event.ChargePortLatch != last.ChargePortLatch
		doorChanged := event.ChargePortDoorOpen != nil &&
			(last.ChargePortDoorOpen == nil || *event.ChargePortDoorOpen != *last.ChargePortDoorOpen)
		if !gearChanged && !latchChanged && !doorChanged {
			continue
		}
		if event.Gear == "" {
			event.Gear = last.Gear
		}
		if event.ChargePortLatch == "" {
			event.ChargePortLatch = last.ChargePortLatch
		}
		if event.ChargePortDoorOpen == nil {
			event.ChargePortDoorOpen = last.ChargePortDoorOpen
		}
		out.Events = append(out.Events, event)
		last = event
	}
	return out
}

func theaterSamplesFromTimeline(rows []signal.TimelineRow) []TheaterSample {
	out := make([]TheaterSample, 0, len(rows))
	for _, row := range rows {
		out = append(out, TheaterSample{
			At:                 row.Timestamp.UTC(),
			Gear:               fieldString(row.Fields, "gear"),
			ChargePortDoorOpen: fieldBool(row.Fields, "charge_port_door_open"),
			ChargePortLatch:    fieldString(row.Fields, "charge_port_latch"),
		})
	}
	return out
}
