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
	edgeSet := make(map[string]struct{})
	edges := []LineageEdge{}

	addNode := func(n LineageNode) {
		if _, ok := nodes[n.ID]; !ok {
			nodes[n.ID] = n
		}
	}

	// addEdge deduplicates edges the same way addNode deduplicates
	// nodes. Many fields share a destination (routing.yaml routes
	// well over a hundred fields to signal_log and dozens to drop),
	// so without deduplication the router→writer and writer→table
	// edges for those shared destinations would be emitted once per
	// field, flooding the Sankey/DAG with identical parallel edges.
	addEdge := func(from, to string) {
		key := from + "\x00" + to
		if _, ok := edgeSet[key]; ok {
			return
		}
		edgeSet[key] = struct{}{}
		edges = append(edges, LineageEdge{From: from, To: to})
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

		addEdge(sourceID, routerID)
		addEdge(routerID, writerID)
		addEdge(writerID, tableID)
		if e.ToColdLogToo {
			slWriter := "writer:signal_log_dual"
			slTable := "table:signal_log"
			addNode(LineageNode{ID: slWriter, Label: "signal_log (dual)", Kind: "writer"})
			addNode(LineageNode{ID: slTable, Label: "signal_log", Kind: "table"})
			addEdge(routerID, slWriter)
			addEdge(slWriter, slTable)
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
