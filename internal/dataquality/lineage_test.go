// White-box tests for BuildLineage. Exercised against the embedded
// production routing.yaml (via router.Load), so these assertions double
// as a contract test for the shipped routing config: every edge must be
// referentially valid, unique, sorted and correctly typed. The uniqueness
// assertion in particular guards the historical duplicate-edge bug where
// the 140+ fields sharing the signal_log destination each emitted their
// own identical router→writer→table edges.

package dataquality

import (
	"strings"
	"testing"
)

func mustBuild(t *testing.T) *LineageGraph {
	t.Helper()
	g, err := BuildLineage()
	if err != nil {
		t.Fatalf("BuildLineage: %v", err)
	}
	if g == nil {
		t.Fatal("BuildLineage returned nil graph")
	}
	return g
}

func TestBuildLineage_NonEmpty(t *testing.T) {
	g := mustBuild(t)
	if len(g.Nodes) == 0 {
		t.Error("expected nodes from embedded routing.yaml")
	}
	if len(g.Edges) == 0 {
		t.Error("expected edges from embedded routing.yaml")
	}
}

func TestBuildLineage_NodesSortedAndUnique(t *testing.T) {
	g := mustBuild(t)
	seen := make(map[string]struct{}, len(g.Nodes))
	for i, n := range g.Nodes {
		if _, dup := seen[n.ID]; dup {
			t.Errorf("duplicate node ID %q", n.ID)
		}
		seen[n.ID] = struct{}{}
		if i > 0 && g.Nodes[i-1].ID > n.ID {
			t.Errorf("nodes not sorted by ID at %d: %q > %q", i, g.Nodes[i-1].ID, n.ID)
		}
	}
}

// The core of the duplicate-edge fix: edges must be unique and sorted by
// (From, To). Before the fix, shared destinations (signal_log, drop)
// produced one identical edge per field.
func TestBuildLineage_EdgesUniqueAndSorted(t *testing.T) {
	g := mustBuild(t)
	seen := make(map[string]struct{}, len(g.Edges))
	for i, e := range g.Edges {
		key := e.From + "\x00" + e.To
		if _, dup := seen[key]; dup {
			t.Errorf("duplicate edge %q -> %q", e.From, e.To)
		}
		seen[key] = struct{}{}
		if i > 0 {
			prev := g.Edges[i-1]
			if prev.From > e.From || (prev.From == e.From && prev.To > e.To) {
				t.Errorf("edges not sorted at %d: (%q,%q) > (%q,%q)",
					i, prev.From, prev.To, e.From, e.To)
			}
		}
	}
}

func TestBuildLineage_ReferentialIntegrity(t *testing.T) {
	g := mustBuild(t)
	ids := make(map[string]LineageNode, len(g.Nodes))
	for _, n := range g.Nodes {
		ids[n.ID] = n
	}
	for _, e := range g.Edges {
		if _, ok := ids[e.From]; !ok {
			t.Errorf("edge From references unknown node %q", e.From)
		}
		if _, ok := ids[e.To]; !ok {
			t.Errorf("edge To references unknown node %q", e.To)
		}
	}
}

func TestBuildLineage_SingleRouterNode(t *testing.T) {
	g := mustBuild(t)
	routers := 0
	for _, n := range g.Nodes {
		if n.Kind == "router" {
			routers++
			if n.ID != "router" {
				t.Errorf("router node ID = %q, want \"router\"", n.ID)
			}
			if n.Label != "Tesla router" {
				t.Errorf("router label = %q, want \"Tesla router\"", n.Label)
			}
		}
	}
	if routers != 1 {
		t.Errorf("router node count = %d, want exactly 1", routers)
	}
}

func TestBuildLineage_KindsAndIDPrefixes(t *testing.T) {
	g := mustBuild(t)
	kinds := map[string]int{}
	for _, n := range g.Nodes {
		kinds[n.Kind]++
		switch n.Kind {
		case "source":
			if !strings.HasPrefix(n.ID, "src:") {
				t.Errorf("source node ID %q missing src: prefix", n.ID)
			}
		case "writer":
			if !strings.HasPrefix(n.ID, "writer:") {
				t.Errorf("writer node ID %q missing writer: prefix", n.ID)
			}
		case "table":
			if !strings.HasPrefix(n.ID, "table:") {
				t.Errorf("table node ID %q missing table: prefix", n.ID)
			}
		case "router":
			// validated in TestBuildLineage_SingleRouterNode
		default:
			t.Errorf("unexpected node kind %q on %q", n.Kind, n.ID)
		}
	}
	for _, k := range []string{"source", "router", "writer", "table"} {
		if kinds[k] == 0 {
			t.Errorf("expected at least one node of kind %q", k)
		}
	}
}

// Every source must connect to the router, and every non-drop writer must
// connect to its table. This walks the graph structure the SPA renders.
func TestBuildLineage_SourceRouterWriterTableChain(t *testing.T) {
	g := mustBuild(t)
	out := make(map[string]map[string]bool)
	for _, e := range g.Edges {
		if out[e.From] == nil {
			out[e.From] = map[string]bool{}
		}
		out[e.From][e.To] = true
	}
	byID := make(map[string]LineageNode, len(g.Nodes))
	for _, n := range g.Nodes {
		byID[n.ID] = n
	}

	for _, n := range g.Nodes {
		switch n.Kind {
		case "source":
			if !out[n.ID]["router"] {
				t.Errorf("source %q has no edge to router", n.ID)
			}
		case "writer":
			// A writer must feed exactly the table with the matching
			// destination suffix (signal_log_dual feeds table:signal_log).
			wantTable := "table:" + strings.TrimPrefix(n.ID, "writer:")
			if n.ID == "writer:signal_log_dual" {
				wantTable = "table:signal_log"
			}
			if !out[n.ID][wantTable] {
				t.Errorf("writer %q has no edge to %q", n.ID, wantTable)
			}
			if _, ok := byID[wantTable]; !ok {
				t.Errorf("writer %q target table %q not a node", n.ID, wantTable)
			}
		}
	}
}

// routing.yaml contains entries with also_signal_log: true, so the dual
// write branch must materialise the dedicated dual writer plus its edges.
func TestBuildLineage_DualWriteBranch(t *testing.T) {
	g := mustBuild(t)
	byID := make(map[string]LineageNode, len(g.Nodes))
	for _, n := range g.Nodes {
		byID[n.ID] = n
	}
	dual, ok := byID["writer:signal_log_dual"]
	if !ok {
		t.Fatal("expected writer:signal_log_dual node (also_signal_log entries exist)")
	}
	if dual.Kind != "writer" {
		t.Errorf("dual writer kind = %q, want writer", dual.Kind)
	}
	if dual.Label != "signal_log (dual)" {
		t.Errorf("dual writer label = %q, want \"signal_log (dual)\"", dual.Label)
	}
	if _, ok := byID["table:signal_log"]; !ok {
		t.Fatal("expected table:signal_log node")
	}

	haveRouterToDual, haveDualToTable := false, false
	for _, e := range g.Edges {
		if e.From == "router" && e.To == "writer:signal_log_dual" {
			haveRouterToDual = true
		}
		if e.From == "writer:signal_log_dual" && e.To == "table:signal_log" {
			haveDualToTable = true
		}
	}
	if !haveRouterToDual {
		t.Error("missing edge router -> writer:signal_log_dual")
	}
	if !haveDualToTable {
		t.Error("missing edge writer:signal_log_dual -> table:signal_log")
	}
}

// Static config in, static graph out: two builds must be byte-for-byte
// equal (stable sort, no map-iteration nondeterminism leaking through).
func TestBuildLineage_Deterministic(t *testing.T) {
	a := mustBuild(t)
	b := mustBuild(t)
	if len(a.Nodes) != len(b.Nodes) {
		t.Fatalf("node counts differ: %d vs %d", len(a.Nodes), len(b.Nodes))
	}
	if len(a.Edges) != len(b.Edges) {
		t.Fatalf("edge counts differ: %d vs %d", len(a.Edges), len(b.Edges))
	}
	for i := range a.Nodes {
		if a.Nodes[i] != b.Nodes[i] {
			t.Errorf("node %d differs: %+v vs %+v", i, a.Nodes[i], b.Nodes[i])
		}
	}
	for i := range a.Edges {
		if a.Edges[i] != b.Edges[i] {
			t.Errorf("edge %d differs: %+v vs %+v", i, a.Edges[i], b.Edges[i])
		}
	}
}
