// Command fleet-config-validator is a one-shot CLI gate that catches
// the most common pre-deployment foot-guns in TeslaSync's Tesla
// Fleet-Telemetry plumbing BEFORE `docker compose up` or a Helm
// upgrade rolls out a broken configuration.
//
// What it validates
// ─────────────────
//  1. fleet-telemetry-config.json
//     - Parses as JSON (no trailing comma, no comment, no BOM).
//     - host is present and non-empty.
//     - port is in [1024, 65535] (privileged ports refused — Tesla's
//       reference manifest uses 4443 and our docker-compose binds it).
//     - tls.server_cert + tls.server_key are non-empty paths;
//       additionally, when --check-paths is passed, validates that
//       the files exist on the local filesystem.
//     - mqtt.broker matches /^[a-z0-9.-]+:[0-9]+$/ — a non-URL
//       host:port string. Catches the classic "tcp://mosquitto:1883"
//       mistake that Fleet Telemetry silently rejects.
//     - mqtt.qos is 0, 1, or 2.
//     - records.V exists and lists at least "mqtt". This is the
//       routing key our PipelineSubscriber depends on; misnaming it
//       (e.g. "v" lowercase, or omitting it) silently disables the
//       entire ingest pipeline.
//
//  2. internal/tesla/router/routing.yaml
//     - Parses as YAML.
//     - Every entry has both `field:` and `dest:`.
//     - No duplicate `field:` entries (would crash the router at
//       Load anyway, but we'd rather catch it pre-deploy).
//     - Every `dest:` is one of the closed set in
//       internal/tesla/router/types.go.
//
//  3. Cross-validation
//     - When --strict is passed, requires that every routing.yaml
//       destination has at least ONE field routed to it. A
//       destination with zero entries usually indicates a forgotten
//       migration from one writer to another (e.g. positions →
//       location_snapshot).
//
// Exit codes
// ──────────
//
//	0  All checks passed.
//	1  At least one validation failure (details printed to stderr).
//	2  IO or parse error before validation could start.
//
// Output format
// ─────────────
// Human-readable by default. Pass --json to emit a structured
// {"ok": bool, "failures": [{"file","rule","message"}]} envelope
// suitable for CI gate consumption.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
	"gopkg.in/yaml.v3"
)

// validDests is the canonical closed set the router accepts. Kept in
// sync via a unit test (cmd/fleet-config-validator/main_test.go)
// that walks router package constants reflectively.
var validDests = map[router.Destination]bool{
	router.DestPositions:         true,
	router.DestClimateSnapshot:   true,
	router.DestSecurityEvent:     true,
	router.DestMotorSnapshot:     true,
	router.DestTirePressure:      true,
	router.DestMediaSnapshot:     true,
	router.DestSafetySnapshot:    true,
	router.DestLocationSnapshot:  true,
	router.DestChargingTelemetry: true,
	router.DestDriveTelemetry:    true,
	router.DestSignalLog:         true,
	router.DestUnitHistory:       true,
	router.DestDrop:              true,
}

// brokerHostPortRE catches the "tcp://host:port" mistake — Fleet
// Telemetry expects bare host:port; the scheme prefix is silently
// invalid and the subscription never establishes.
var brokerHostPortRE = regexp.MustCompile(`^[a-zA-Z0-9.-]+:[0-9]{1,5}$`)

type fleetConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`
	TLS  struct {
		ServerCert string `json:"server_cert"`
		ServerKey  string `json:"server_key"`
	} `json:"tls"`
	MQTT struct {
		Broker    string `json:"broker"`
		ClientID  string `json:"client_id"`
		TopicBase string `json:"topic_base"`
		QoS       int    `json:"qos"`
	} `json:"mqtt"`
	Records map[string][]string `json:"records"`
}

type routingFile struct {
	Routes []router.Entry `yaml:"routes"`
}

type failure struct {
	File    string `json:"file"`
	Rule    string `json:"rule"`
	Message string `json:"message"`
}

type report struct {
	OK       bool      `json:"ok"`
	Failures []failure `json:"failures"`
}

func main() {
	var (
		fleetPath   = flag.String("fleet-config", "fleet-telemetry-config.json", "Path to fleet-telemetry-config.json")
		routingPath = flag.String("routing", "internal/tesla/router/routing.yaml", "Path to routing.yaml")
		checkPaths  = flag.Bool("check-paths", false, "Verify TLS cert/key paths exist on disk")
		strict      = flag.Bool("strict", false, "Require every destination has at least one field routed to it")
		jsonOut     = flag.Bool("json", false, "Emit JSON report instead of human-readable output")
	)
	flag.Parse()

	r, err := validate(*fleetPath, *routingPath, *checkPaths, *strict)
	if err != nil {
		fmt.Fprintf(os.Stderr, "fleet-config-validator: %v\n", err)
		os.Exit(2)
	}

	if *jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
	} else {
		printHuman(r)
	}
	if !r.OK {
		os.Exit(1)
	}
}

func validate(fleetPath, routingPath string, checkPaths, strict bool) (report, error) {
	var r report
	r.OK = true

	if err := validateFleetConfig(fleetPath, checkPaths, &r); err != nil {
		return report{}, err
	}
	if err := validateRouting(routingPath, strict, &r); err != nil {
		return report{}, err
	}

	if len(r.Failures) > 0 {
		r.OK = false
	}
	// Stable order so a CI diff stays diffable.
	sort.Slice(r.Failures, func(i, j int) bool {
		if r.Failures[i].File != r.Failures[j].File {
			return r.Failures[i].File < r.Failures[j].File
		}
		if r.Failures[i].Rule != r.Failures[j].Rule {
			return r.Failures[i].Rule < r.Failures[j].Rule
		}
		return r.Failures[i].Message < r.Failures[j].Message
	})
	return r, nil
}

func validateFleetConfig(path string, checkPaths bool, r *report) error {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	var cfg fleetConfig
	if err := json.Unmarshal(bytes, &cfg); err != nil {
		r.Failures = append(r.Failures, failure{
			File: path, Rule: "json_parse",
			Message: fmt.Sprintf("invalid JSON: %v", err),
		})
		return nil
	}

	if strings.TrimSpace(cfg.Host) == "" {
		r.Failures = append(r.Failures, failure{
			File: path, Rule: "host_required",
			Message: "host is empty; Fleet Telemetry refuses to bind",
		})
	}
	if cfg.Port < 1024 || cfg.Port > 65535 {
		r.Failures = append(r.Failures, failure{
			File: path, Rule: "port_range",
			Message: fmt.Sprintf("port=%d outside [1024, 65535]", cfg.Port),
		})
	}
	if strings.TrimSpace(cfg.TLS.ServerCert) == "" {
		r.Failures = append(r.Failures, failure{
			File: path, Rule: "tls_cert_required",
			Message: "tls.server_cert is empty; Tesla requires mTLS",
		})
	}
	if strings.TrimSpace(cfg.TLS.ServerKey) == "" {
		r.Failures = append(r.Failures, failure{
			File: path, Rule: "tls_key_required",
			Message: "tls.server_key is empty; Tesla requires mTLS",
		})
	}
	if checkPaths {
		for _, p := range []string{cfg.TLS.ServerCert, cfg.TLS.ServerKey} {
			if p == "" {
				continue
			}
			if _, err := os.Stat(p); err != nil {
				if errors.Is(err, os.ErrNotExist) {
					r.Failures = append(r.Failures, failure{
						File: path, Rule: "tls_path_missing",
						Message: fmt.Sprintf("%s does not exist on disk", p),
					})
				}
			}
		}
	}
	if cfg.MQTT.Broker == "" {
		r.Failures = append(r.Failures, failure{
			File: path, Rule: "mqtt_broker_required",
			Message: "mqtt.broker is empty",
		})
	} else if !brokerHostPortRE.MatchString(cfg.MQTT.Broker) {
		r.Failures = append(r.Failures, failure{
			File: path, Rule: "mqtt_broker_format",
			Message: fmt.Sprintf("mqtt.broker=%q must be host:port (no scheme, no slashes)", cfg.MQTT.Broker),
		})
	}
	if cfg.MQTT.QoS < 0 || cfg.MQTT.QoS > 2 {
		r.Failures = append(r.Failures, failure{
			File: path, Rule: "mqtt_qos_range",
			Message: fmt.Sprintf("mqtt.qos=%d must be 0, 1, or 2", cfg.MQTT.QoS),
		})
	}
	if records, ok := cfg.Records["V"]; !ok {
		r.Failures = append(r.Failures, failure{
			File: path, Rule: "records_v_missing",
			Message: `records.V is missing; PipelineSubscriber depends on the "V" record type`,
		})
	} else {
		var hasMqtt bool
		for _, dest := range records {
			if dest == "mqtt" {
				hasMqtt = true
				break
			}
		}
		if !hasMqtt {
			r.Failures = append(r.Failures, failure{
				File: path, Rule: "records_v_no_mqtt",
				Message: `records.V does not include "mqtt"; ingest pipeline will receive nothing`,
			})
		}
	}
	return nil
}

func validateRouting(path string, strict bool, r *report) error {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	var rf routingFile
	if err := yaml.Unmarshal(bytes, &rf); err != nil {
		r.Failures = append(r.Failures, failure{
			File: path, Rule: "yaml_parse",
			Message: fmt.Sprintf("invalid YAML: %v", err),
		})
		return nil
	}

	seen := map[string]int{}
	usedDests := map[router.Destination]int{}
	for _, entry := range rf.Routes {
		if entry.Field == "" {
			r.Failures = append(r.Failures, failure{
				File: path, Rule: "field_required",
				Message: "entry with empty field:",
			})
			continue
		}
		if entry.Destination == "" {
			r.Failures = append(r.Failures, failure{
				File: path, Rule: "dest_required",
				Message: fmt.Sprintf("field=%s has no dest:", entry.Field),
			})
			continue
		}
		seen[entry.Field]++
		usedDests[entry.Destination]++
		if !validDests[entry.Destination] {
			r.Failures = append(r.Failures, failure{
				File: path, Rule: "dest_unknown",
				Message: fmt.Sprintf("field=%s dest=%q is not a known destination", entry.Field, string(entry.Destination)),
			})
		}
	}
	for field, count := range seen {
		if count > 1 {
			r.Failures = append(r.Failures, failure{
				File: path, Rule: "field_duplicate",
				Message: fmt.Sprintf("field=%s appears %d times (ambiguous routing)", field, count),
			})
		}
	}
	if strict {
		for d := range validDests {
			if d == router.DestDrop {
				continue
			}
			if usedDests[d] == 0 {
				r.Failures = append(r.Failures, failure{
					File: path, Rule: "dest_unused",
					Message: fmt.Sprintf("destination %q has zero routes (strict mode)", string(d)),
				})
			}
		}
	}
	return nil
}

func printHuman(r report) {
	if r.OK {
		fmt.Println("✅ fleet-config-validator: all checks passed")
		return
	}
	fmt.Printf("❌ fleet-config-validator: %d failure(s)\n", len(r.Failures))
	for _, f := range r.Failures {
		fmt.Printf("  - %s [%s]: %s\n", filepath.ToSlash(f.File), f.Rule, f.Message)
	}
}
