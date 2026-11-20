package actioncentersvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type SmartChargingReader interface {
	ListCandidates(context.Context, string, *int64, time.Time, int) ([]port.Candidate, error)
}

type smartChargingProvider struct{ reader SmartChargingReader }

func (p smartChargingProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceSmartCharging
}

func (p smartChargingProvider) Recommendations(
	ctx context.Context, filter ListFilter, now time.Time,
) ([]domain.Candidate, error) {
	rows, err := p.reader.ListCandidates(ctx, filter.subject, filter.VehicleID, now, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		observedAt := row.Decision.ObservedAt.UTC()
		sourceKey := fmt.Sprintf("charging_plan:%d", row.Plan.ID)
		path := fmt.Sprintf("/settings?vehicle_id=%d#smart-charging", row.Plan.VehicleID)
		evidenceKind := "charging_readiness"
		title := "Plug in before your planned trip"
		rationale := "Fresh parked and disconnected signals place the vehicle inside the selected charging location."
		basis := []string{
			"Fresh battery, gear, plug state and location observations",
			"Trip consumption and reserve were entered by the recipient",
		}
		limitations := []string{
			"Return charge is an estimate based on the range you entered, not a measurement.",
			"This recommendation cannot start charging or operate the vehicle.",
		}
		summary := fmt.Sprintf(
			"Battery %.0f%% at %s; the entered trip estimate suggests %.0f-%.0f%% on return versus a %.0f%% reserve.",
			row.Decision.BatteryPct, row.PlaceName, row.Decision.ArrivalLowPct,
			row.Decision.ArrivalHighPct, row.Plan.ReservePct,
		)
		var chargingPowerW *float64
		var scheduledStartAt *time.Time
		var scheduledPowerCeilingW *float64
		if row.Decision.Kind == readiness.DecisionSlowCharging {
			evidenceKind = "charging_feasibility"
			title = "Charging may not be ready before your trip"
			path = fmt.Sprintf("/charging/schedule?vehicle_id=%d", row.Plan.VehicleID)
			summary = fmt.Sprintf(
				"Battery %.0f%% at %s. At the measured %.0f W, the estimated return is %.0f-%.0f%% versus a %.0f%% reserve.",
				row.Decision.BatteryPct, row.PlaceName, row.Decision.ChargingPowerW, row.Decision.ArrivalLowPct,
				row.Decision.ArrivalHighPct, row.Plan.ReservePct,
			)
			rationale = "Fresh samples over at least five minutes indicate the current charging rate may not meet the trip reserve."
			basis = []string{
				"Fresh parked, charging, battery, pack-energy and charging-power observations",
				"Trip consumption and reserve were entered by the recipient",
			}
			limitations = []string{
				"The estimate assumes constant power and nominal pack energy; actual power, taper and efficiency can change.",
				"This recommendation does not change a schedule, charging limit or vehicle setting.",
			}
			chargingPowerW = &row.Decision.ChargingPowerW
		} else if row.Decision.Kind == readiness.DecisionScheduleConflict && row.Plan.ScheduledStart != nil {
			path = fmt.Sprintf("/charging/schedule?vehicle_id=%d", row.Plan.VehicleID)
			scheduledStartAt = &row.Plan.ScheduledStart.At
			title = "Review charging scheduled for departure or later"
			rationale = "The vehicle is plugged in and reports a pending schedule matching the entered start's clock time."
			summary = fmt.Sprintf("Battery %.0f%% at %s. If charging follows your entered start, it will not add charge before departure.",
				row.Decision.BatteryPct, row.PlaceName)
			basis = append(basis, "Fresh charging-port latch and pending schedule observations")
			limitations = append(limitations, "The vehicle reports a clock time, not the date of the next start. No schedule was changed.")
			if scheduledStartAt.Before(row.Plan.DepartureAt) && row.Plan.ScheduledStart.PowerCeilingW != nil {
				scheduledPowerCeilingW = row.Plan.ScheduledStart.PowerCeilingW
				title = "Scheduled charging may finish too late for your trip"
				summary = fmt.Sprintf("Battery %.0f%% at %s. Even at the %.0f W site limit you entered, the estimated reserve would fall short.",
					row.Decision.BatteryPct, row.PlaceName, *scheduledPowerCeilingW)
				basis = append(basis, "Fresh nominal pack energy and the entered site power limit")
				limitations = append(limitations, "The estimate assumes uninterrupted charging at the entered limit without losses. The limit is not measured power.")
			}
		} else if row.Decision.Kind == readiness.DecisionTripReview {
			title = "Review a charging stop before your trip"
			rationale = "Even the lower entered trip-use estimates cannot meet the reserve by charging only at the selected place."
			summary = fmt.Sprintf("Battery %.0f%% at %s. Review a stop or record planned destination charging.",
				row.Decision.BatteryPct, row.PlaceName)
		}
		if projection := row.Decision.TripProjection; projection != nil {
			if row.Decision.Kind != readiness.DecisionTripReview && scheduledStartAt == nil {
				summary = fmt.Sprintf("Battery %.0f%% at %s.", row.Decision.BatteryPct, row.PlaceName)
				if chargingPowerW != nil {
					summary += fmt.Sprintf(" Measured charging power is %.0f W.", *chargingPowerW)
				}
			}
			summary += fmt.Sprintf(" Using %.0f%% at departure, ", projection.StartingBatteryPct)
			if projection.DestinationReachability == "unreachable" {
				summary += "the destination cannot be reached under the entered estimates."
			} else {
				summary += fmt.Sprintf("the destination estimate is %.0f-%.0f%%",
					projection.DestinationLowPct, projection.DestinationHighPct)
				if projection.DestinationReachability == "uncertain" {
					summary += " and reaching it is uncertain"
				}
				summary += "."
				if projection.ReturnReachability == "unreachable" {
					summary += " The return needs another charge under the entered estimates."
				} else if projection.ReturnLowPct != nil && projection.ReturnHighPct != nil {
					summary += fmt.Sprintf(" The conditional return estimate is %.0f-%.0f%% versus a %.0f%% reserve.",
						*projection.ReturnLowPct, *projection.ReturnHighPct, row.Plan.ReservePct)
				}
			}
			if projection.DestinationChargePct == nil {
				limitations = append(limitations, "The return estimate assumes no destination charging.")
			} else {
				limitations = append(limitations, "The planned destination charge is an assumption, not a confirmed or guaranteed charge.")
			}
			limitations = append(limitations, "These projections are estimates; a 0% bound can mean the leg cannot be completed.")
		}
		if current := row.Decision.CurrentLimit; current != nil && row.Decision.Kind == readiness.DecisionSlowCharging {
			summary += fmt.Sprintf(" The vehicle reports an AC current request of %.1f A and maximum request of %.1f A.",
				current.RequestedA, current.MaximumA)
			summary += " Review the current setting and site electrical limits; the reported maximum does not establish that increasing current is safe or will help."
			basis = append(basis, "Fresh AC current request and maximum request observations")
			limitations = append(limitations, "Review the current setting and site electrical limits; the reported maximum does not establish that increasing current is safe or will help.")
		}
		items = append(items, domain.Candidate{
			SourceFeature:   domain.SourceSmartCharging,
			SourceKey:       sourceKey,
			DedupKey:        sourceKey,
			Vehicle:         &domain.VehicleRef{ID: row.Plan.VehicleID, DisplayName: row.VehicleName},
			Title:           title,
			Summary:         summary,
			Rationale:       rationale,
			Priority:        domain.PriorityMedium,
			Severity:        domain.SeverityWarning,
			BaseConfidence:  0.8,
			ConfidenceBasis: basis,
			Evidence: []domain.EvidenceItem{{
				ID: sourceKey, Kind: evidenceKind, Summary: summary,
				Provenance: domain.EvidenceProvenance{Source: "live_signal_store", RecordID: sourceKey},
				ObservedAt: &observedAt,
				ChargingReadiness: &domain.ChargingReadinessEvidence{
					PlanID: row.Plan.ID, Kind: string(row.Decision.Kind),
					PlaceName: row.PlaceName, BatteryPct: row.Decision.BatteryPct,
					ArrivalLowPct: row.Decision.ArrivalLowPct, ArrivalHighPct: row.Decision.ArrivalHighPct,
					ReservePct: row.Plan.ReservePct, ChargingPowerW: chargingPowerW,
					CurrentLimit: row.Decision.CurrentLimit, TripProjection: row.Decision.TripProjection,
					DepartureAt: row.Plan.DepartureAt, ScheduledStartAt: scheduledStartAt,
					ScheduledPowerCeilingW: scheduledPowerCeilingW,
				},
			}},
			SafeActions:    []domain.ActionType{domain.ActionNavigate, domain.ActionSmartChargingSnooze},
			NavigationPath: &path,
			ObservedAt:     &observedAt,
			FreshFor:       signal.LiveSignalFreshnessThreshold,
			AgingFor:       signal.LiveSignalFreshnessThreshold,
			ExpiresAt:      row.Decision.ExpiresAt,
			Limitations:    limitations,
		})
	}
	return items, nil
}
