package heretraffic

import (
	"context"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	minLiveCoverage   = 0.95
	minLiveConfidence = 0.75
)

type routingResponse struct {
	Routes  []routingRoute `json:"routes"`
	Notices []struct{}     `json:"notices"`
}

type routingRoute struct {
	Labels   []routingLabel `json:"routeLabels"`
	Sections []struct {
		Type         string            `json:"type"`
		Polyline     string            `json:"polyline"`
		Notices      []struct{}        `json:"notices"`
		Replacements map[string]string `json:"refReplacements"`
		Summary      struct {
			DurationS int64   `json:"duration"`
			LengthM   float64 `json:"length"`
		} `json:"summary"`
		Spans []struct {
			LengthM float64 `json:"length"`
			Ref     string  `json:"segmentRef"`
		} `json:"spans"`
	} `json:"sections"`
	Notices []struct{} `json:"notices"`
}

type routingLabel struct {
	Type string `json:"label_type"`
	Name struct {
		Value string `json:"value"`
	} `json:"name"`
}

type routeEstimate struct {
	durationS int64
	lengthM   float64
	spans     []routeSpan
	label     string
}

type routeSpan struct {
	lengthM float64
	ref     segmentRef
}

type segmentRef struct {
	wire string
	key  string
	from float64
	to   float64
}

func qualifyRoute(route routingRoute) (routeEstimate, bool) {
	var result routeEstimate
	if len(route.Notices) > 0 || len(route.Sections) == 0 || len(route.Sections) > 12 {
		return result, false
	}
	for _, section := range route.Sections {
		if section.Type != "vehicle" || section.Polyline == "" || len(section.Notices) > 0 ||
			section.Summary.DurationS <= 0 || section.Summary.DurationS > 3*3600 ||
			!inRange(section.Summary.LengthM, 1, 200_000) ||
			len(section.Spans) == 0 || len(result.spans)+len(section.Spans) > maxRouteSegments {
			return routeEstimate{}, false
		}
		var spanLengthM float64
		for _, span := range section.Spans {
			if !inRange(span.LengthM, 0, section.Summary.LengthM) {
				return routeEstimate{}, false
			}
			spanLengthM += span.LengthM
			if span.LengthM > 0 {
				result.spans = append(result.spans, routeSpan{
					lengthM: span.LengthM, ref: parseSegmentRef(span.Ref, section.Replacements),
				})
			}
		}
		if math.Abs(spanLengthM-section.Summary.LengthM) > math.Max(2, 0.01*section.Summary.LengthM) {
			return routeEstimate{}, false
		}
		result.durationS += section.Summary.DurationS
		result.lengthM += max(spanLengthM, section.Summary.LengthM)
	}
	result.label = routeLabel(route.Labels)
	return result, result.durationS <= 3*3600 && result.lengthM <= 200_000 && len(result.spans) > 0
}

func routeLabel(labels []routingLabel) string {
	var names []string
	for _, entry := range labels[:min(len(labels), 2)] {
		name := strings.TrimSpace(entry.Name.Value)
		if (entry.Type == "Name" || entry.Type == "RouteNumber") && name != "" &&
			utf8.RuneCountInString(name) <= 55 &&
			!strings.ContainsFunc(name, func(r rune) bool { return unicode.IsControl(r) || unicode.Is(unicode.Cf, r) }) &&
			!slices.Contains(names, name) {
			names = append(names, name)
		}
	}
	return strings.Join(names, ", ")
}

func parseSegmentRef(compact string, replacements map[string]string) segmentRef {
	if compact == "" || len(compact) > 512 {
		return segmentRef{}
	}
	parts := strings.Split(compact, ":")
	for i, part := range parts {
		if strings.HasPrefix(part, "$") {
			parts[i] = replacements[part[1:]]
			if parts[i] == "" {
				return segmentRef{}
			}
		}
	}
	wire := strings.Join(parts, ":")
	base, direction, ok := strings.Cut(wire, "#")
	if !ok || !strings.HasPrefix(base, "hrn:here:data:") || strings.ContainsAny(base, "$ \t\r\n") ||
		len(direction) == 0 || (direction[0] != '+' && direction[0] != '-') {
		return segmentRef{}
	}
	from, to := 0.0, 1.0
	if len(direction) > 1 {
		a, b, found := strings.Cut(direction[1:], "..")
		start, startErr := strconv.ParseFloat(a, 64)
		end, endErr := strconv.ParseFloat(b, 64)
		if !found || startErr != nil || endErr != nil || !inRange(start, 0, 1) || !inRange(end, 0, 1) || start >= end {
			return segmentRef{}
		}
		from, to = start, end
	}
	return segmentRef{wire: wire, key: base + direction[:1], from: from, to: to}
}

func differsFrom(usual, alternative routeEstimate) bool {
	usualKeys := make(map[string]bool, len(usual.spans))
	for _, span := range usual.spans {
		usualKeys[span.ref.key] = true
	}
	var differentM float64
	for _, span := range alternative.spans {
		if span.ref.key != "" && !usualKeys[span.ref.key] {
			differentM += span.lengthM
		}
	}
	return differentM >= math.Max(500, 0.10*alternative.lengthM)
}

type flowSegment struct {
	Ref string `json:"ref"`
}

type flowRequest struct {
	In struct {
		Type     string        `json:"type"`
		Segments []flowSegment `json:"segments"`
	} `json:"in"`
	LocationReferencing []string `json:"locationReferencing"`
}

type flowResponse struct {
	SourceUpdated time.Time         `json:"sourceUpdated"`
	Replacements  map[string]string `json:"refReplacements"`
	Results       []struct {
		Location struct {
			SegmentRef struct {
				Segments []flowSegment `json:"segments"`
			} `json:"segmentRef"`
		} `json:"location"`
		CurrentFlow struct {
			flowQuality
			SubSegments []flowQuality `json:"subSegments"`
		} `json:"currentFlow"`
	} `json:"results"`
}

type flowQuality struct {
	Confidence     float64 `json:"confidence"`
	SpeedMps       float64 `json:"speed"`
	JamFactor      float64 `json:"jamFactor"`
	Traversability string  `json:"traversability"`
}

func (flow flowQuality) closed() bool {
	return flow.JamFactor >= 10 || (flow.Traversability != "" && flow.Traversability != "open")
}

func (flow flowQuality) usable() bool {
	return !flow.closed() && inRange(flow.Confidence, minLiveConfidence, 1) && inRange(flow.SpeedMps, 0.01, 100)
}

func (c *Client) liveCoverage(ctx context.Context, authorize func(context.Context) error, routes []routeEstimate) (time.Time, []bool, error) {
	known := make(map[string]bool)
	var requested []flowSegment
	for _, route := range routes {
		for _, span := range route.spans {
			if w := span.ref.wire; w != "" && !known[w] {
				known[w] = true
				requested = append(requested, flowSegment{Ref: w})
			}
		}
	}
	var observedAt time.Time
	live := make(map[string][]segmentRef)
	closed := make(map[string][]segmentRef)
	for refs := range slices.Chunk(requested, maxFlowRefs) {
		request := flowRequest{LocationReferencing: []string{"segmentRef"}}
		request.In.Type, request.In.Segments = "segmentRef", refs
		var response flowResponse
		if err := c.call(ctx, authorize, http.MethodPost, c.trafficURL+"/flow", nil, request, &response); err != nil {
			return time.Time{}, nil, err
		}
		now := c.now().UTC()
		if response.SourceUpdated.After(now) || !response.SourceUpdated.After(now.Add(-flowFreshness)) {
			return time.Time{}, nil, ErrInsufficientEvidence
		}
		if observedAt.IsZero() || response.SourceUpdated.Before(observedAt) {
			observedAt = response.SourceUpdated.UTC()
		}
		for _, result := range response.Results {
			isLive, isClosed := result.CurrentFlow.usable(), result.CurrentFlow.closed()
			for _, sub := range result.CurrentFlow.SubSegments {
				isLive = isLive && sub.usable()
				isClosed = isClosed || sub.closed()
			}
			for _, raw := range result.Location.SegmentRef.Segments {
				ref := parseSegmentRef(raw.Ref, response.Replacements)
				if ref.key == "" {
					continue
				}
				if isClosed {
					closed[ref.key] = append(closed[ref.key], ref)
				} else if isLive {
					live[ref.key] = append(live[ref.key], ref)
				}
			}
		}
	}
	if !observedAt.After(c.now().UTC().Add(-flowFreshness)) {
		return time.Time{}, nil, ErrInsufficientEvidence
	}
	covered := make([]bool, len(routes))
	for i, route := range routes {
		covered[i] = routeCovers(route, live, closed)
	}
	return observedAt, covered, nil
}

func routeCovers(route routeEstimate, live, closed map[string][]segmentRef) bool {
	var coveredM float64
	for _, span := range route.spans {
		ref := span.ref
		for _, closure := range closed[ref.key] {
			if closure.from < ref.to && closure.to > ref.from {
				return false
			}
		}
		for _, observed := range live[ref.key] {
			if observed.from <= ref.from && observed.to >= ref.to {
				coveredM += span.lengthM
				break
			}
		}
	}
	return coveredM >= minLiveCoverage*route.lengthM
}
