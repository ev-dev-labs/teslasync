package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// devToolsStartTime records when this process started, for uptime calculation.
var devToolsStartTime = time.Now()

// DevToolsHandler provides developer utilities for Tesla Fleet API setup.
type DevToolsHandler struct {
	teslaClient *tesla.Client
	db          *database.DB
	mqttClient  *mqtt.Client
	cfg         *config.Config
}

// DevToolsOption is a functional option for configuring DevToolsHandler.
type DevToolsOption func(*DevToolsHandler)

// WithDB adds a database client to the handler.
func WithDB(db *database.DB) DevToolsOption {
	return func(h *DevToolsHandler) { h.db = db }
}

// WithMQTTClient adds an MQTT client to the handler.
func WithMQTTClient(mc *mqtt.Client) DevToolsOption {
	return func(h *DevToolsHandler) { h.mqttClient = mc }
}

// WithConfig adds configuration to the handler.
func WithConfig(cfg *config.Config) DevToolsOption {
	return func(h *DevToolsHandler) { h.cfg = cfg }
}

// NewDevToolsHandler creates a new developer tools handler.
// Accepts optional functional options for backward compatibility.
func NewDevToolsHandler(tc *tesla.Client, opts ...DevToolsOption) *DevToolsHandler {
	h := &DevToolsHandler{teslaClient: tc}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// ---------------------------------------------------------------------------
// Existing endpoints
// ---------------------------------------------------------------------------

// DetectRegion calls the Tesla Fleet API to detect the user's region.
func (h *DevToolsHandler) DetectRegion(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusPreconditionFailed, "Tesla account not connected. Please authenticate first.")
		return
	}

	data, status, err := h.teslaClient.GetUserRegion(r.Context())
	if err != nil {
		log.Warn().Err(err).Int("status", status).Msg("region detection failed")
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		w.Write(data)
	}
}

// RegisterPartner registers the partner account in the configured region.
func (h *DevToolsHandler) RegisterPartner(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Domain string `json:"domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Domain == "" {
		writeError(w, http.StatusBadRequest, "domain is required")
		return
	}

	// Get a partner (client_credentials) token
	partnerToken, err := h.teslaClient.GetPartnerToken(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get partner token")
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":   "Failed to obtain partner token",
			"details": err.Error(),
		})
		return
	}

	// Use the partner token to register
	data, status, err := h.teslaClient.RegisterPartner(r.Context(), req.Domain)
	if err != nil {
		log.Warn().Err(err).Int("status", status).Msg("partner registration failed")
	}

	// Return raw Tesla response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		w.Write(data)
	} else {
		writeJSON(w, status, map[string]interface{}{
			"error":         "Registration request failed",
			"details":       err.Error(),
			"partner_token": partnerToken != "",
		})
	}
}

// FleetAPIInfo returns current Fleet API configuration details.
func (h *DevToolsHandler) FleetAPIInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"base_url":        h.teslaClient.BaseURL(),
		"client_id":       h.teslaClient.ClientID(),
		"has_valid_token": h.teslaClient.HasValidToken(),
		"public_key_url":  "https://YOUR_DOMAIN/.well-known/appspecific/com.tesla.3p.public-key.pem",
		"regions": map[string]string{
			"na": "https://fleet-api.prd.na.vn.cloud.tesla.com",
			"eu": "https://fleet-api.prd.eu.vn.cloud.tesla.com",
			"cn": "https://fleet-api.prd.cn.vn.cloud.tesla.com",
		},
	})
}

// ---------------------------------------------------------------------------
// Tesla API endpoints
// ---------------------------------------------------------------------------

// TestAPIConnectivity tests whether the Tesla Fleet API base URL is reachable.
func (h *DevToolsHandler) TestAPIConnectivity(w http.ResponseWriter, r *http.Request) {
	baseURL := h.teslaClient.BaseURL()

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodHead, baseURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build request: "+err.Error())
		return
	}

	start := time.Now()
	resp, err := http.DefaultClient.Do(req)
	latency := time.Since(start)

	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"reachable":  false,
			"base_url":   baseURL,
			"error":      err.Error(),
			"latency_ms": latency.Milliseconds(),
		})
		return
	}
	defer resp.Body.Close()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"reachable":   true,
		"base_url":    baseURL,
		"status_code": resp.StatusCode,
		"latency_ms":  latency.Milliseconds(),
	})
}

// TokenInfo returns metadata about the current Tesla API token without
// exposing the token value itself.
func (h *DevToolsHandler) TokenInfo(w http.ResponseWriter, r *http.Request) {
	valid := h.teslaClient.HasValidToken()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"has_valid_token": valid,
		"client_id":      h.teslaClient.ClientID(),
	})
}

// ---------------------------------------------------------------------------
// Database endpoints
// ---------------------------------------------------------------------------

// DatabaseStats returns public table names, row counts, and database size.
func (h *DevToolsHandler) DatabaseStats(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not configured")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	// Fetch public tables.
	rows, err := h.db.Pool.Query(ctx,
		"SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public'")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list tables: "+err.Error())
		return
	}
	defer rows.Close()

	type tableInfo struct {
		Schema   string `json:"schema"`
		Name     string `json:"name"`
		RowCount int64  `json:"row_count"`
	}

	var tables []tableInfo
	for rows.Next() {
		var t tableInfo
		if err := rows.Scan(&t.Schema, &t.Name); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan table row: "+err.Error())
			return
		}
		tables = append(tables, t)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "row iteration error: "+err.Error())
		return
	}

	// Get row counts for each table.
	for i := range tables {
		query := fmt.Sprintf("SELECT COUNT(*) FROM %q.%q", tables[i].Schema, tables[i].Name)
		if err := h.db.Pool.QueryRow(ctx, query).Scan(&tables[i].RowCount); err != nil {
			log.Warn().Err(err).Str("table", tables[i].Name).Msg("failed to count rows")
		}
	}

	// Get total database size.
	var dbSize int64
	if err := h.db.Pool.QueryRow(ctx,
		"SELECT pg_database_size(current_database())").Scan(&dbSize); err != nil {
		log.Warn().Err(err).Msg("failed to get database size")
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tables":        tables,
		"table_count":   len(tables),
		"database_size": dbSize,
	})
}

// MigrationStatus returns the current schema migration version.
func (h *DevToolsHandler) MigrationStatus(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not configured")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var version int64
	var dirty bool
	err := h.db.Pool.QueryRow(ctx,
		"SELECT version, dirty FROM schema_migrations ORDER BY version DESC LIMIT 1").Scan(&version, &dirty)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read migration status: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"version": version,
		"dirty":   dirty,
	})
}

// ---------------------------------------------------------------------------
// MQTT endpoints
// ---------------------------------------------------------------------------

// MQTTTest publishes a test message and reports MQTT connectivity status.
func (h *DevToolsHandler) MQTTTest(w http.ResponseWriter, r *http.Request) {
	if h.mqttClient == nil {
		writeError(w, http.StatusServiceUnavailable, "MQTT client not configured")
		return
	}

	connected := h.mqttClient.IsConnected()
	if !connected {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"connected": false,
			"message":   "MQTT client is not connected",
		})
		return
	}

	topic := "teslasync/dev-tools/ping"
	payload := fmt.Sprintf(`{"timestamp":"%s","source":"dev-tools"}`, time.Now().UTC().Format(time.RFC3339))
	h.mqttClient.Publish(topic, payload)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"connected": true,
		"topic":     topic,
		"payload":   payload,
		"message":   "test message published",
	})
}

// ---------------------------------------------------------------------------
// System endpoints
// ---------------------------------------------------------------------------

// requiredEnvVars is the list of environment variables checked by EnvCheck.
var requiredEnvVars = []string{
	"TESLA_CLIENT_ID",
	"TESLA_CLIENT_SECRET",
	"TESLA_API_BASE_URL",
	"TESLA_REDIRECT_URI",
	"DATABASE_HOST",
	"DATABASE_PORT",
	"DATABASE_USER",
	"DATABASE_PASS",
	"DATABASE_NAME",
	"MQTT_HOST",
	"MQTT_PORT",
	"REDIS_HOST",
	"REDIS_PORT",
	"FLEET_TELEMETRY_ENABLED",
	"FLEET_TELEMETRY_HOST",
}

// EnvCheck reports which required environment variables are set or unset.
// It never exposes actual values.
func (h *DevToolsHandler) EnvCheck(w http.ResponseWriter, r *http.Request) {
	vars := make(map[string]string, len(requiredEnvVars))
	setCount := 0
	for _, key := range requiredEnvVars {
		if _, ok := os.LookupEnv(key); ok {
			vars[key] = "set"
			setCount++
		} else {
			vars[key] = "unset"
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"variables":   vars,
		"total":       len(requiredEnvVars),
		"set_count":   setCount,
		"unset_count": len(requiredEnvVars) - setCount,
	})
}

// RuntimeInfo returns Go runtime diagnostics.
func (h *DevToolsHandler) RuntimeInfo(w http.ResponseWriter, r *http.Request) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"go_version":    runtime.Version(),
		"goroutines":    runtime.NumGoroutine(),
		"gomaxprocs":    runtime.GOMAXPROCS(0),
		"num_cpu":       runtime.NumCPU(),
		"uptime_seconds": int64(time.Since(devToolsStartTime).Seconds()),
		"memory": map[string]interface{}{
			"alloc_bytes":       mem.Alloc,
			"total_alloc_bytes": mem.TotalAlloc,
			"sys_bytes":         mem.Sys,
			"num_gc":            mem.NumGC,
			"heap_objects":      mem.HeapObjects,
		},
	})
}
