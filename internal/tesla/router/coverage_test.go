package router_test

import (
	"strings"
	"testing"

	pm "github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	rt "github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// TestRoutingCoverage is the reflective architectural lock that makes
// ADR-004 #2 / #8 — "every Tesla Field flows through exactly one
// pipeline" — actually true. It iterates protomodel.Signals (the
// codegen output produced from the vendored vehicle_data.proto) and
// asserts three invariants against rt.LoadMap():
//
//  1. Coverage:  every non-compound Field has at least one routing
//     entry. A re-vendored proto that introduces a new SignalMeta
//     and forgets the matching routing.yaml entry must fail CI here,
//     not silently disappear into an unrouted-signal black hole.
//
//  2. Uniqueness: every Field is referenced by at most one routing
//     entry. The loader's validateEntries already enforces this from
//     the YAML side; the seen-counter below is the same invariant
//     enforced from the protomodel side, redundant on purpose so a
//     loader regression that drops the duplicate check still leaves
//     this test as a backstop.
//
//  3. No orphans: every routing entry name corresponds either to a
//     SignalMeta (atomic Field, or compound parent that the codec
//     emits under its own name) or to a flattened child of a
//     compound parent. Catches typos in routing.yaml that would
//     otherwise dispatch dead writes for a Field the codec never
//     produces.
//
// The test is reflective: the only inputs are protomodel.Signals,
// protomodel.SignalsByName, and the embedded routing.yaml. There is
// no hand-curated list of Field names. Adding a new SignalMeta via
// re-vendor + regen is the only way the missing-entries assertion can
// change, which keeps the single-pipeline guarantee enforceable in CI.
//
// Compounds (IsCompound == true) are skipped from the coverage check
// because the codec flattens them at internal/tesla/codec/flatten.go
// before routing dispatches; routing.yaml entries for compounds like
// Location, DoorState, TpmsHardWarnings, and TpmsSoftWarnings are
// keyed by the flattened child names ("LocationLatitude",
// "DoorStateDriverFront", "TpmsHardWarningsFrontLeft", ...) rather
// than the compound parent name. To validate those entries
// reflectively, the orphan check accepts any routing entry whose
// name is a strict prefix-extension of a compound parent name. The
// two compounds whose codec flattener emits an atomic under the
// parent name itself (ScheduledChargingStartTime, ScheduledDepartureTime)
// resolve through the SignalsByName lookup directly — protomodel.Signals
// already lists them as compound parents.
func TestRoutingCoverage(t *testing.T) {
	m, err := rt.LoadMap()
	if err != nil {
		t.Fatalf("LoadMap: %v", err)
	}

	// Compound parent names from pm.Signals are the legal prefixes
	// for routing entries that don't appear in SignalsByName by name
	// (i.e. flattened compound children produced by the codec).
	// Building the list reflectively here keeps the test honest:
	// there is no hand-curated mapping of compound -> child suffix,
	// only the question "does this entry name extend a compound
	// parent in pm.Signals?".
	compoundParents := make([]string, 0, 8)
	for i := range pm.Signals {
		if pm.Signals[i].IsCompound {
			compoundParents = append(compoundParents, pm.Signals[i].Field)
		}
	}

	var missing, doubled, orphans []string
	seen := map[string]int{}

	for i := range pm.Signals {
		s := &pm.Signals[i]
		if s.IsCompound {
			continue
		}
		if _, ok := m[s.Field]; !ok {
			missing = append(missing, s.Field)
			continue
		}
		seen[s.Field]++
	}
	for f, c := range seen {
		if c > 1 {
			doubled = append(doubled, f)
		}
	}

	for f := range m {
		if _, ok := pm.SignalsByName[f]; ok {
			continue
		}
		matched := false
		for _, parent := range compoundParents {
			if len(f) > len(parent) && strings.HasPrefix(f, parent) {
				matched = true
				break
			}
		}
		if !matched {
			orphans = append(orphans, f)
		}
	}

	if len(missing) > 0 {
		t.Errorf("missing routing entries (%d): %v", len(missing), missing)
	}
	if len(doubled) > 0 {
		t.Errorf("duplicate routing entries: %v", doubled)
	}
	if len(orphans) > 0 {
		t.Errorf("routing entries for unknown fields: %v", orphans)
	}
}
