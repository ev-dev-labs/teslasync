// Package teslaphysics derives Tesla-honest charge, park, FSD-counter, and
// ownership views from signal_log and live state.
//
// What this package never claims:
//
//   - Autopilot/FSD engagement, interventions, or disengagements
//   - Exact FSD-active road segments
//   - That FSD caused an efficiency change
//   - That Neutral is parked
//   - That ChargeState Stopped or Complete is an unplug
//
// Charge sessions end at Disconnected. Park is confirmed Gear=P. FSD numbers
// are resettable trip meters (SelfDrivingMilesSinceReset), and a silent
// counter while moving is labelled counter-silent, never a disengagement.
package teslaphysics
