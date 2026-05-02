package api

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// devToolsStartTime records when this process started, for uptime calculation.
var devToolsStartTime = time.Now()

// DevToolsHandler provides developer utilities for Tesla Fleet API setup.
type DevToolsHandler struct {
	teslaClient  *tesla.Client
	db           *database.DB
	mqttClient   *mqtt.Client
	cfg          *config.Config
	fleetSubRepo *database.FleetSubscriptionRepo
	settingsRepo *database.SettingsRepo
	redisCache   *signal.RedisSignalCache
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

// WithRedisSignalCache adds a Redis signal cache for the redis-signals diagnostic endpoint.
func WithRedisSignalCache(rc *signal.RedisSignalCache) DevToolsOption {
	return func(h *DevToolsHandler) { h.redisCache = rc }
}

// NewDevToolsHandler creates a new developer tools handler.
// Accepts optional functional options for backward compatibility.
func NewDevToolsHandler(tc *tesla.Client, opts ...DevToolsOption) *DevToolsHandler {
	h := &DevToolsHandler{teslaClient: tc}
	for _, opt := range opts {
		opt(h)
	}
	if h.db != nil {
		h.fleetSubRepo = database.NewFleetSubscriptionRepo(h.db)
		h.settingsRepo = database.NewSettingsRepo(h.db)
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
	data, status, err := h.teslaClient.RegisterPartner(r.Context(), partnerToken, req.Domain)
	if err != nil {
		log.Warn().Err(err).Int("status", status).Msg("partner registration failed")
	}

	// Return raw Tesla response
	w.Header().Set("Content-Type", "application/json")
	if data != nil && isJSON(data) {
		w.WriteHeader(status)
		w.Write(data)
	} else {
		// Tesla may return HTML on auth errors — wrap it cleanly
		errMsg := "Registration request failed"
		details := "Tesla returned a non-JSON response (likely an auth redirect or error page)"
		if err != nil {
			details = err.Error()
		}
		if status == 0 {
			status = http.StatusBadGateway
		}
		writeJSON(w, status, map[string]interface{}{
			"error":         errMsg,
			"details":       details,
			"partner_token": partnerToken != "",
			"status_code":   status,
		})
	}
}

// PartnerPublicKey fetches the registered public key for a domain from Tesla
// and compares it against the locally stored key in tesla_public_key.
func (h *DevToolsHandler) PartnerPublicKey(w http.ResponseWriter, r *http.Request) {
	domain := strings.TrimSpace(r.URL.Query().Get("domain"))
	if domain == "" {
		writeError(w, http.StatusBadRequest, "domain query parameter is required")
		return
	}

	data, status, err := h.teslaClient.GetPartnerPublicKey(r.Context(), domain)
	if err != nil {
		log.Warn().Err(err).Int("status", status).Str("domain", domain).Msg("partner public key fetch failed")
	}

	w.Header().Set("Content-Type", "application/json")
	if data != nil && isJSON(data) {
		// Try to compare with the locally stored public key
		var envelope struct {
			Response struct {
				PublicKey string `json:"public_key"`
			} `json:"response"`
		}
		matchResult := map[string]interface{}{}
		if json.Unmarshal(data, &envelope) == nil && envelope.Response.PublicKey != "" {
			matchResult["remote_key_found"] = true
			if h.db != nil {
				var localPEM string
				localErr := h.db.Pool.QueryRow(r.Context(),
					`SELECT public_key_pem FROM tesla_public_key WHERE id = 1`,
				).Scan(&localPEM)
				if localErr == nil && localPEM != "" {
					remotePEM := strings.TrimSpace(envelope.Response.PublicKey)
					localPEM = strings.TrimSpace(localPEM)
					matchResult["matches_local"] = remotePEM == localPEM
					matchResult["local_key_configured"] = true
				} else {
					matchResult["matches_local"] = false
					matchResult["local_key_configured"] = false
				}
			}
		} else {
			matchResult["remote_key_found"] = false
		}

		// Merge comparison into the Tesla response
		var raw map[string]interface{}
		if json.Unmarshal(data, &raw) == nil {
			raw["verification"] = matchResult
			w.WriteHeader(status)
			json.NewEncoder(w).Encode(raw)
		} else {
			w.WriteHeader(status)
			w.Write(data)
		}
	} else {
		errMsg := "Failed to fetch partner public key from Tesla"
		details := "Tesla returned a non-JSON response"
		if err != nil {
			details = err.Error()
		}
		if status == 0 {
			status = http.StatusBadGateway
		}
		writeJSON(w, status, map[string]interface{}{
			"error":       errMsg,
			"details":     details,
			"status_code": status,
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
	// devtools-tile-probe is the prompt-mandated service tag for the
	// outbound HEAD probe of the Tesla Fleet API base URL. Constructed
	// per-call so the latest SetOutboundSink wiring is honoured.
	probeClient := httputil.NewClient(httputil.ClientConfig{
		Name:          "devtools-tile-probe",
		Timeout:       10 * time.Second,
		Sink:          currentOutboundSink(),
		EnableLogging: true,
	})
	resp, err := probeClient.Do(req)
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
		"client_id":       h.teslaClient.ClientID(),
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

	poolStats := h.db.Pool.Stat()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"go_version":     runtime.Version(),
		"goroutines":     runtime.NumGoroutine(),
		"gomaxprocs":     runtime.GOMAXPROCS(0),
		"num_cpu":        runtime.NumCPU(),
		"uptime_seconds": int64(time.Since(devToolsStartTime).Seconds()),
		"memory": map[string]interface{}{
			"alloc_bytes":       mem.Alloc,
			"total_alloc_bytes": mem.TotalAlloc,
			"sys_bytes":         mem.Sys,
			"num_gc":            mem.NumGC,
			"heap_objects":      mem.HeapObjects,
		},
		"max_open":   poolStats.MaxConns(),
		"open":       poolStats.TotalConns(),
		"in_use":     poolStats.AcquiredConns(),
		"idle":       poolStats.IdleConns(),
		"wait_count": poolStats.EmptyAcquireCount(),
	})
}

// ---------------------------------------------------------------------------
// Tesla Public Key Management
// ---------------------------------------------------------------------------

// GenerateKeypair generates an ECDSA P-256 keypair, stores the public key in DB,
// and returns the private key ONE TIME (never stored).
func (h *DevToolsHandler) GenerateKeypair(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusInternalServerError, "database not available")
		return
	}

	// Generate ECDSA P-256 key
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate keypair")
		return
	}

	// Encode private key to PEM
	privBytes, err := x509.MarshalECPrivateKey(privateKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to marshal private key")
		return
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: privBytes})

	// Encode public key to PEM
	pubBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to marshal public key")
		return
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubBytes})

	// Calculate fingerprint (SHA-256 of DER-encoded public key)
	hash := sha256.Sum256(pubBytes)
	fingerprint := fmt.Sprintf("%x", hash)

	// Store public key in DB (upsert)
	_, err = h.db.Pool.Exec(r.Context(),
		`INSERT INTO tesla_public_key (id, public_key_pem, fingerprint, created_at)
		 VALUES (1, $1, $2, NOW())
		 ON CONFLICT (id) DO UPDATE SET public_key_pem = $1, fingerprint = $2, created_at = NOW()`,
		string(pubPEM), fingerprint)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store public key: "+err.Error())
		return
	}

	log.Info().Str("fingerprint", fingerprint).Msg("generated new Tesla keypair")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"private_key_pem": string(privPEM),
		"public_key_pem":  string(pubPEM),
		"fingerprint":     fingerprint,
		"warning":         "Save the private key now. It will NOT be shown again.",
	})
}

// UploadPublicKey accepts a PEM-encoded public key and stores it.
func (h *DevToolsHandler) UploadPublicKey(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusInternalServerError, "database not available")
		return
	}

	var req struct {
		PublicKeyPEM string `json:"public_key_pem"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PublicKeyPEM == "" {
		writeError(w, http.StatusBadRequest, "public_key_pem is required")
		return
	}

	// Validate it's a valid PEM public key
	block, _ := pem.Decode([]byte(req.PublicKeyPEM))
	if block == nil {
		writeError(w, http.StatusBadRequest, "invalid PEM format")
		return
	}
	pubKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid public key: "+err.Error())
		return
	}

	// Verify it's an EC key
	if _, ok := pubKey.(*ecdsa.PublicKey); !ok {
		writeError(w, http.StatusBadRequest, "key must be an ECDSA public key (P-256)")
		return
	}

	// Calculate fingerprint
	hash := sha256.Sum256(block.Bytes)
	fingerprint := fmt.Sprintf("%x", hash)

	_, err = h.db.Pool.Exec(r.Context(),
		`INSERT INTO tesla_public_key (id, public_key_pem, fingerprint, created_at)
		 VALUES (1, $1, $2, NOW())
		 ON CONFLICT (id) DO UPDATE SET public_key_pem = $1, fingerprint = $2, created_at = NOW()`,
		req.PublicKeyPEM, fingerprint)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store public key")
		return
	}

	log.Info().Str("fingerprint", fingerprint).Msg("uploaded Tesla public key")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "stored",
		"fingerprint": fingerprint,
	})
}

// PublicKeyStatus returns the current public key status.
func (h *DevToolsHandler) PublicKeyStatus(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"configured": false})
		return
	}

	var pubPEM, fingerprint string
	var createdAt time.Time
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT public_key_pem, fingerprint, created_at FROM tesla_public_key WHERE id = 1`,
	).Scan(&pubPEM, &fingerprint, &createdAt)

	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"configured":      false,
			"well_known_path": "/.well-known/appspecific/com.tesla.3p.public-key.pem",
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"configured":      true,
		"fingerprint":     fingerprint,
		"created_at":      createdAt,
		"well_known_path": "/.well-known/appspecific/com.tesla.3p.public-key.pem",
		"public_key_pem":  pubPEM,
	})
}

// DeletePublicKey removes the stored public key.
func (h *DevToolsHandler) DeletePublicKey(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusInternalServerError, "database not available")
		return
	}

	_, err := h.db.Pool.Exec(r.Context(), `DELETE FROM tesla_public_key WHERE id = 1`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete public key")
		return
	}

	log.Info().Msg("deleted Tesla public key")
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "deleted"})
}

// ServePublicKey serves the PEM at the Tesla-required .well-known path.
func (h *DevToolsHandler) ServePublicKey(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "not configured", http.StatusNotFound)
		return
	}

	var pubPEM string
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT public_key_pem FROM tesla_public_key WHERE id = 1`,
	).Scan(&pubPEM)
	if err != nil {
		http.Error(w, "no public key configured", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/x-pem-file")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(pubPEM))
}

// PairVehicleKey pairs the stored public key with a vehicle for command signing.
func (h *DevToolsHandler) PairVehicleKey(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusInternalServerError, "database not available")
		return
	}
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusPreconditionFailed, "Tesla account not connected")
		return
	}

	var req struct {
		VIN string `json:"vin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.VIN == "" {
		writeError(w, http.StatusBadRequest, "vin is required")
		return
	}

	// Get stored public key
	var pubPEM string
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT public_key_pem FROM tesla_public_key WHERE id = 1`,
	).Scan(&pubPEM)
	if err != nil {
		writeError(w, http.StatusPreconditionFailed, "no public key configured — generate one in Dev Tools first")
		return
	}

	data, status, err := h.teslaClient.PairKey(r.Context(), req.VIN, pubPEM)
	if err != nil {
		log.Warn().Err(err).Str("vin", req.VIN).Msg("vehicle key pairing failed")
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		w.Write(data)
	}
}

// letsEncryptCA returns the ISRG Root X1 CA certificate used by Let's Encrypt.
// This is required for fleet telemetry subscription — vehicles use it to verify
// the TLS connection to the fleet telemetry server.
func letsEncryptCA() string {
	return `-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----`
}

// isJSON returns true if the data looks like a JSON response.
func isJSON(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	// Trim whitespace and check first character
	for _, b := range data {
		if b == ' ' || b == '\t' || b == '\n' || b == '\r' {
			continue
		}
		return b == '{' || b == '[' || b == '"'
	}
	return false
}

// ──────────────────────────────────────────────────────────────────
// Fleet Telemetry Configuration
// ──────────────────────────────────────────────────────────────────

// FleetTelemetrySubscribe configures vehicles to stream telemetry data.
// POST /api/v1/dev-tools/fleet-telemetry-subscribe
func (h *DevToolsHandler) FleetTelemetrySubscribe(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusPreconditionFailed, "Tesla account not connected")
		return
	}

	var req struct {
		VINs           []string       `json:"vins"`
		Hostname       string         `json:"hostname"`
		Port           int            `json:"port"`
		CA             string         `json:"ca"`
		Fields         []string       `json:"fields"`
		Interval       int            `json:"interval_seconds"`
		FieldIntervals map[string]int `json:"field_intervals"` // per-signal interval overrides
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.VINs) == 0 {
		writeError(w, http.StatusBadRequest, "at least one VIN is required")
		return
	}
	if req.Hostname == "" {
		// Fall back to config
		if h.cfg != nil && h.cfg.FleetTelemetry.Host != "" {
			req.Hostname = h.cfg.FleetTelemetry.Host
		} else {
			writeError(w, http.StatusBadRequest, "hostname is required (or set FLEET_TELEMETRY_HOST)")
			return
		}
	}
	if req.Port == 0 {
		if h.cfg != nil && h.cfg.FleetTelemetry.Port > 0 {
			req.Port = h.cfg.FleetTelemetry.Port
		} else {
			req.Port = 4443
		}
	}
	if req.Interval == 0 {
		req.Interval = 10
	}

	// Build fields map
	fields := make(map[string]tesla.FleetTelemetryField)
	if len(req.Fields) == 0 {
		// Default essential fields
		req.Fields = []string{
			"VehicleSpeed", "Odometer", "Soc", "BatteryLevel",
			"Location", "GpsHeading",
			"ChargeState", "ChargeLimitSoc",
			"InsideTemp", "OutsideTemp",
			"Locked", "SentryMode",
		}
	}
	// Fields that require minimum_delta to be explicitly set
	minDeltaFields := map[string]float64{
		"SelfDrivingMilesSinceReset": 1.0,
		"MilesSinceReset":            1.0,
	}

	for _, f := range req.Fields {
		// Per-signal interval from UI takes priority, otherwise use global interval
		interval := req.Interval
		if perSignal, ok := req.FieldIntervals[f]; ok {
			interval = perSignal
		}
		field := tesla.FleetTelemetryField{IntervalSeconds: interval}
		if delta, ok := minDeltaFields[f]; ok {
			field.MinimumDelta = &delta
		}
		fields[f] = field
	}

	var caValue string
	if ca := strings.TrimSpace(req.CA); ca != "" {
		caValue = ca
	} else {
		// Auto-fetch CA from the fleet telemetry TLS certificate
		// For Let's Encrypt, use the ISRG Root X1 certificate
		caValue = letsEncryptCA()
	}

	sub := tesla.FleetTelemetrySubscription{
		VINs: req.VINs,
		Config: tesla.FleetTelemetryConfigPayload{
			Hostname: req.Hostname,
			Port:     req.Port,
			CA:       &caValue,
			Fields:   fields,
		},
	}

	log.Info().
		Strs("vins", req.VINs).
		Str("hostname", req.Hostname).
		Int("port", req.Port).
		Int("fields", len(fields)).
		Msg("subscribing vehicles to fleet telemetry")

	data, status, err := h.teslaClient.SubscribeFleetTelemetry(r.Context(), sub)
	if err != nil {
		log.Warn().Err(err).Int("status", status).Msg("fleet telemetry subscription failed")
	}

	// Persist subscription for audit trail
	if h.fleetSubRepo != nil {
		signalNames := make([]string, 0, len(req.Fields))
		signalNames = append(signalNames, req.Fields...)
		for _, vin := range req.VINs {
			subRecord := &models.FleetTelemetrySubscription{
				VIN:             vin,
				Signals:         signalNames,
				IntervalSeconds: req.Interval,
				FieldIntervals:  req.FieldIntervals,
				Hostname:        req.Hostname,
				Port:            req.Port,
				Protocol:        "wss",
				SubscribedAt:    time.Now().UTC(),
				Status:          "active",
				ResponseCode:    &status,
			}
			if err != nil {
				errStr := err.Error()
				subRecord.ResponseBody = &errStr
				subRecord.Status = "failed"
			}
			if dbErr := h.fleetSubRepo.Create(r.Context(), subRecord); dbErr != nil {
				log.Warn().Err(dbErr).Str("vin", vin).Msg("failed to persist fleet telemetry subscription")
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if data != nil && isJSON(data) {
		w.WriteHeader(status)
		w.Write(data)
	} else {
		errMsg := "Fleet telemetry subscription failed"
		details := "Tesla returned a non-JSON response"
		if err != nil {
			details = err.Error()
		}
		if status == 0 {
			status = http.StatusBadGateway
		}
		writeJSON(w, status, map[string]interface{}{
			"error":   errMsg,
			"details": details,
		})
	}
}

// FleetTelemetryGetConfig returns the fleet telemetry configuration for a vehicle.
// GET /api/v1/dev-tools/fleet-telemetry-config?vin=...
func (h *DevToolsHandler) FleetTelemetryGetConfig(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusPreconditionFailed, "Tesla account not connected")
		return
	}

	vin := r.URL.Query().Get("vin")
	if vin == "" {
		writeError(w, http.StatusBadRequest, "vin query parameter is required")
		return
	}

	data, status, err := h.teslaClient.GetFleetTelemetryConfig(r.Context(), vin)
	if err != nil {
		log.Warn().Err(err).Str("vin", vin).Msg("get fleet telemetry config failed")
	}

	w.Header().Set("Content-Type", "application/json")
	if data != nil && isJSON(data) {
		w.WriteHeader(status)
		w.Write(data)
	} else {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":   "Failed to fetch fleet telemetry config",
			"details": errStringOrDefault(err, "non-JSON response from Tesla"),
		})
	}
}

// FleetTelemetryDeleteConfig removes fleet telemetry configuration for a vehicle.
// DELETE /api/v1/dev-tools/fleet-telemetry-config?vin=...
func (h *DevToolsHandler) FleetTelemetryDeleteConfig(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusPreconditionFailed, "Tesla account not connected")
		return
	}

	vin := r.URL.Query().Get("vin")
	if vin == "" {
		writeError(w, http.StatusBadRequest, "vin query parameter is required")
		return
	}

	data, status, err := h.teslaClient.DeleteFleetTelemetryConfig(r.Context(), vin)
	if err != nil {
		log.Warn().Err(err).Str("vin", vin).Msg("delete fleet telemetry config failed")
	}

	w.Header().Set("Content-Type", "application/json")
	if data != nil && isJSON(data) {
		w.WriteHeader(status)
		w.Write(data)
	} else {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":   "Failed to delete fleet telemetry config",
			"details": errStringOrDefault(err, "non-JSON response from Tesla"),
		})
	}
}

// FleetTelemetryErrors returns recent fleet telemetry errors for a vehicle.
// GET /api/v1/dev-tools/fleet-telemetry-errors?vin=...
func (h *DevToolsHandler) FleetTelemetryErrors(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusPreconditionFailed, "Tesla account not connected")
		return
	}

	vin := r.URL.Query().Get("vin")
	if vin == "" {
		writeError(w, http.StatusBadRequest, "vin query parameter is required")
		return
	}

	data, status, err := h.teslaClient.GetFleetTelemetryErrors(r.Context(), vin)
	if err != nil {
		log.Warn().Err(err).Str("vin", vin).Msg("get fleet telemetry errors failed")
	}

	w.Header().Set("Content-Type", "application/json")
	if data != nil && isJSON(data) {
		w.WriteHeader(status)
		w.Write(data)
	} else {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":   "Failed to fetch fleet telemetry errors",
			"details": errStringOrDefault(err, "non-JSON response from Tesla"),
		})
	}
}

// FleetStatus provides fleet information for vehicles.
// POST /api/v1/dev-tools/fleet-status
func (h *DevToolsHandler) FleetStatus(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusPreconditionFailed, "Tesla account not connected")
		return
	}

	var req struct {
		VINs []string `json:"vins"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.VINs) == 0 {
		writeError(w, http.StatusBadRequest, "vins array is required")
		return
	}

	data, status, err := h.teslaClient.GetFleetStatus(r.Context(), req.VINs)
	if err != nil {
		log.Warn().Err(err).Msg("get fleet status failed")
	}

	w.Header().Set("Content-Type", "application/json")
	if data != nil && isJSON(data) {
		w.WriteHeader(status)
		w.Write(data)
	} else {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":   "Failed to fetch fleet status",
			"details": errStringOrDefault(err, "non-JSON response from Tesla"),
		})
	}
}

// NearbyChargingSites returns charging sites near the vehicle.
func (h *DevToolsHandler) NearbyChargingSites(w http.ResponseWriter, r *http.Request) {
	vin := r.URL.Query().Get("vin")
	if vin == "" {
		writeError(w, http.StatusBadRequest, "vin is required")
		return
	}
	data, status, err := h.teslaClient.GetNearbyChargingSites(r.Context(), vin)
	if err != nil {
		log.Warn().Err(err).Str("vin", vin).Msg("get nearby charging sites failed")
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		w.Write(data)
	}
}

// ReleaseNotes returns firmware release notes.
func (h *DevToolsHandler) ReleaseNotes(w http.ResponseWriter, r *http.Request) {
	vin := r.URL.Query().Get("vin")
	if vin == "" {
		writeError(w, http.StatusBadRequest, "vin is required")
		return
	}
	data, status, err := h.teslaClient.GetReleaseNotes(r.Context(), vin)
	if err != nil {
		log.Warn().Err(err).Str("vin", vin).Msg("get release notes failed")
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		w.Write(data)
	}
}

// RecentAlerts returns recent vehicle alerts from Tesla.
func (h *DevToolsHandler) RecentAlerts(w http.ResponseWriter, r *http.Request) {
	vin := r.URL.Query().Get("vin")
	if vin == "" {
		writeError(w, http.StatusBadRequest, "vin is required")
		return
	}
	data, status, err := h.teslaClient.GetRecentAlerts(r.Context(), vin)
	if err != nil {
		log.Warn().Err(err).Str("vin", vin).Msg("get recent alerts failed")
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		w.Write(data)
	}
}

// ServiceData returns vehicle service history and status.
func (h *DevToolsHandler) ServiceData(w http.ResponseWriter, r *http.Request) {
	vin := r.URL.Query().Get("vin")
	if vin == "" {
		writeError(w, http.StatusBadRequest, "vin is required")
		return
	}
	data, status, err := h.teslaClient.GetServiceData(r.Context(), vin)
	if err != nil {
		log.Warn().Err(err).Str("vin", vin).Msg("get service data failed")
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		w.Write(data)
	}
}

func errStringOrDefault(err error, def string) string {
	if err != nil {
		return err.Error()
	}
	return def
}

// RedisSignals returns all cached signal values from Redis for a vehicle.
// GET /api/v1/dev-tools/redis-signals?vehicle_id=X
func (h *DevToolsHandler) RedisSignals(w http.ResponseWriter, r *http.Request) {
	if h.redisCache == nil {
		writeError(w, http.StatusServiceUnavailable, "Redis signal cache is not available")
		return
	}

	vidStr := r.URL.Query().Get("vehicle_id")
	if vidStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id query parameter is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "vehicle_id must be a valid integer")
		return
	}

	signals, err := h.redisCache.GetAll(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("redis signal cache: GetAll failed")
		writeError(w, http.StatusServiceUnavailable, "Redis is unreachable")
		return
	}

	// Build typed signal response
	type signalEntry struct {
		Value interface{} `json:"value"`
		Type  string      `json:"type"`
	}

	result := make(map[string]signalEntry, len(signals))
	for name, val := range signals {
		var sType string
		switch val.(type) {
		case float64:
			sType = "number"
		case bool:
			sType = "boolean"
		default:
			sType = "string"
		}
		result[name] = signalEntry{Value: val, Type: sType}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":   vehicleID,
		"signal_count": len(result),
		"signals":      result,
	})
}
