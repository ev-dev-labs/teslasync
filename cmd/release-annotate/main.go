// cmd/release-annotate posts a Grafana release annotation.
//
//	GRAFANA_URL=https://grafana.internal GRAFANA_TOKEN=… \
//	  go run ./cmd/release-annotate \
//	    -action deploy -version 1.4.2 -commit "$GITHUB_SHA" \
//	    -environment production -stage canary -flags ai-provider-live-calls
//
// Exit codes: 0 success (or a deliberate dry run), 1 failure.
//
// With -dry-run (or no GRAFANA_URL) it prints the payload it *would*
// post and exits 0, so a pipeline without Grafana configured degrades
// to a no-op instead of failing a deploy over an annotation.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// validActions constrains the annotation vocabulary so the Grafana tag
// filter (`tags=release`) stays queryable instead of accumulating
// free-form strings.
var validActions = map[string]bool{
	"deploy":   true,
	"rollback": true,
	"promote":  true,
	"pause":    true,
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr, os.Getenv, time.Now))
}

type options struct {
	action      string
	version     string
	commit      string
	environment string
	stage       string
	flags       string
	dashboardID int
	panelID     int
	note        string
	dryRun      bool
	timeout     time.Duration
}

func parseFlags(args []string, stderr io.Writer) (*options, error) {
	opt := &options{}
	fs := flag.NewFlagSet("release-annotate", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.StringVar(&opt.action, "action", "deploy", "deploy | rollback | promote | pause")
	fs.StringVar(&opt.version, "version", "", "release version (required)")
	fs.StringVar(&opt.commit, "commit", "", "build commit SHA (required)")
	fs.StringVar(&opt.environment, "environment", "", "target environment")
	fs.StringVar(&opt.stage, "stage", "", "rollout stage from ops/rollout/stages.yaml")
	fs.StringVar(&opt.flags, "flags", "", "comma-separated high-risk flags enabled by this change")
	fs.IntVar(&opt.dashboardID, "dashboard-id", 0, "restrict the annotation to one dashboard (0 = global)")
	fs.IntVar(&opt.panelID, "panel-id", 0, "restrict the annotation to one panel (0 = whole dashboard)")
	fs.StringVar(&opt.note, "note", "", "free-text note appended to the annotation body")
	fs.BoolVar(&opt.dryRun, "dry-run", false, "print the payload instead of posting it")
	fs.DurationVar(&opt.timeout, "timeout", 15*time.Second, "HTTP timeout")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return opt, nil
}

// annotation is the Grafana /api/annotations request body.
type annotation struct {
	DashboardUID string   `json:"dashboardUID,omitempty"`
	DashboardID  int      `json:"dashboardId,omitempty"`
	PanelID      int      `json:"panelId,omitempty"`
	Time         int64    `json:"time"`
	TimeEnd      int64    `json:"timeEnd,omitempty"`
	Tags         []string `json:"tags"`
	Text         string   `json:"text"`
}

func run(args []string, stdout, stderr io.Writer, getenv func(string) string, now func() time.Time) int {
	opt, err := parseFlags(args, stderr)
	if err != nil {
		return 1
	}
	if !validActions[opt.action] {
		fmt.Fprintf(stderr, "release-annotate: action %q must be one of deploy, rollback, promote, pause\n", opt.action)
		return 1
	}
	if strings.TrimSpace(opt.version) == "" || strings.TrimSpace(opt.commit) == "" {
		fmt.Fprintln(stderr, "release-annotate: -version and -commit are both required; an annotation without a build identity is not correlatable")
		return 1
	}

	body := buildAnnotation(opt, now())
	payload, err := json.Marshal(body)
	if err != nil {
		fmt.Fprintf(stderr, "release-annotate: %v\n", err)
		return 1
	}

	baseURL := strings.TrimRight(getenv("GRAFANA_URL"), "/")
	token := getenv("GRAFANA_TOKEN")

	// A missing Grafana is a no-op, not a deploy failure. Annotations
	// are observability metadata; losing one must never break a release.
	if opt.dryRun || baseURL == "" {
		reason := "dry run"
		if baseURL == "" {
			reason = "GRAFANA_URL is unset — skipping (annotations never fail a deploy)"
		}
		fmt.Fprintf(stdout, "release-annotate: %s\n%s\n", reason, string(payload))
		return 0
	}
	if token == "" {
		fmt.Fprintln(stderr, "release-annotate: GRAFANA_URL is set but GRAFANA_TOKEN is empty")
		return 1
	}

	ctx, cancel := context.WithTimeout(context.Background(), opt.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/api/annotations", bytes.NewReader(payload))
	if err != nil {
		fmt.Fprintf(stderr, "release-annotate: %v\n", err)
		return 1
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := (&http.Client{Timeout: opt.timeout}).Do(req)
	if err != nil {
		fmt.Fprintf(stderr, "release-annotate: %v\n", err)
		return 1
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		fmt.Fprintf(stderr, "release-annotate: grafana returned %d: %s\n", resp.StatusCode, strings.TrimSpace(string(respBody)))
		return 1
	}
	fmt.Fprintf(stdout, "release-annotate: annotated %s %s (%s) at %s\n", opt.action, opt.version, shortSHA(opt.commit), body.tagsString())
	return 0
}

func buildAnnotation(opt *options, now time.Time) annotation {
	tags := []string{"release", "action:" + opt.action, "version:" + opt.version}
	if sha := shortSHA(opt.commit); sha != "" {
		tags = append(tags, "sha:"+sha)
	}
	if opt.environment != "" {
		tags = append(tags, "env:"+opt.environment)
	}
	if opt.stage != "" {
		tags = append(tags, "stage:"+opt.stage)
	}
	for _, f := range splitFlags(opt.flags) {
		tags = append(tags, "flag:"+f)
	}

	var text strings.Builder
	fmt.Fprintf(&text, "<b>%s</b> %s", strings.ToUpper(opt.action), opt.version)
	if opt.environment != "" {
		fmt.Fprintf(&text, " → %s", opt.environment)
	}
	fmt.Fprintf(&text, "<br/>commit <code>%s</code>", shortSHA(opt.commit))
	if opt.stage != "" {
		fmt.Fprintf(&text, "<br/>stage: %s", opt.stage)
	}
	if flags := splitFlags(opt.flags); len(flags) > 0 {
		fmt.Fprintf(&text, "<br/>high-risk flags enabled: %s", strings.Join(flags, ", "))
	}
	if opt.note != "" {
		fmt.Fprintf(&text, "<br/>%s", opt.note)
	}

	return annotation{
		DashboardID: opt.dashboardID,
		PanelID:     opt.panelID,
		Time:        now.UnixMilli(),
		Tags:        tags,
		Text:        text.String(),
	}
}

func (a annotation) tagsString() string { return strings.Join(a.Tags, " ") }

// shortSHA trims a 40-char commit to the 12 characters humans actually
// compare, while leaving already-short input alone.
func shortSHA(sha string) string {
	sha = strings.TrimSpace(sha)
	if len(sha) > 12 {
		return sha[:12]
	}
	return sha
}

func splitFlags(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
