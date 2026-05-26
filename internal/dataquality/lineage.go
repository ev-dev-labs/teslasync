package dataquality

import (
	"sort"

	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// LineageNode is one node in the static pipeline DAG.
type LineageNode struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"` // source | router | writer | table
}

// LineageEdge connects two nodes.
type LineageEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// LineageGraph is the wire shape consumed by the SPA's Sankey/DAG
// visualisation.
type LineageGraph struct {
	Nodes []LineageNode `json:"nodes"`
	Edges []LineageEdge `json:"edges"`
}

// BuildLineage reads routing.yaml (via the embedded router.Load()) and
// builds the pipeline DAG:
//
//	source(<field>) → router.route(<field>) → writer(<dest>) → table(<dest>)
//
// Plus a dashed dual-write edge to signal_log when also_signal_log is
// true. Static — depends only on the routing config so the lineage is
// the same in every environment.
func BuildLineage() (*LineageGraph, error) {
	entries, err := router.Load()
	if err != nil {
		return nil, err
	}
	nodes := make(map[string]LineageNode)
	edges := []LineageEdge{}

	addNode := func(n LineageNode) {
		if _, ok := nodes[n.ID]; !ok {
			nodes[n.ID] = n
		}
	}

	for _, e := range entries {
		sourceID := "src:" + e.Field
		routerID := "router"
		writerID := "writer:" + string(e.Destination)
		tableID := "table:" + string(e.Destination)

		addNode(LineageNode{ID: sourceID, Label: e.Field, Kind: "source"})
		addNode(LineageNode{ID: routerID, Label: "Tesla router", Kind: "router"})
		addNode(LineageNode{ID: writerID, Label: string(e.Destination), Kind: "writer"})
		addNode(LineageNode{ID: tableID, Label: string(e.Destination), Kind: "table"})

		edges = append(edges,
			LineageEdge{From: sourceID, To: routerID},
			LineageEdge{From: routerID, To: writerID},
			LineageEdge{From: writerID, To: tableID},
		)
		if e.ToColdLogToo {
			slWriter := "writer:signal_log_dual"
			slTable := "table:signal_log"
			addNode(LineageNode{ID: slWriter, Label: "signal_log (dual)", Kind: "writer"})
			addNode(LineageNode{ID: slTable, Label: "signal_log", Kind: "table"})
			edges = append(edges,
				LineageEdge{From: routerID, To: slWriter},
				LineageEdge{From: slWriter, To: slTable},
			)
		}
	}

	out := &LineageGraph{
		Nodes: make([]LineageNode, 0, len(nodes)),
		Edges: edges,
	}
	for _, n := range nodes {
		out.Nodes = append(out.Nodes, n)
	}
	sort.Slice(out.Nodes, func(i, j int) bool { return out.Nodes[i].ID < out.Nodes[j].ID })
	sort.Slice(out.Edges, func(i, j int) bool {
		if out.Edges[i].From != out.Edges[j].From {
			return out.Edges[i].From < out.Edges[j].From
		}
		return out.Edges[i].To < out.Edges[j].To
	})
	return out, nil
}
