package devtools

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

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	teslaconfig "github.com/ev-dev-labs/teslasync/internal/tesla/config"
)

// devToolsStartTime records when this process started, for uptime calculation.
var devToolsStartTime = time.Now()

// SinkProvider is wired by the parent API package so devtools outbound probes
// use the most recently configured api_call_logs sink. The nil default keeps
// package tests and early boot paths no-op.
var SinkProvider func() httputil.APICallSink

func currentSink() httputil.APICallSink {
	if SinkProvider == nil {
		return nil
	}
	return SinkProvider()
}

// DevToolsHandler provides developer utilities for Tesla Fleet API setup.
type DevToolsHandler struct {
	teslaClient  *tesla.Client
	db           *database.DB
	mqttClient   *mqtt.Client
	cfg          *config.Config
	settingsRepo *settingsdb.SettingsRepo
	vehicleRepo  *vehicledb.VehicleRepo
	redisCache   *signal.RedisSignalCache
	signalStore  *signal.Store
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

// WithSignalStore adds the in-process L1 signal store. Used by the
// redis-signals diagnostic endpoint to compare L1 vs L2 state and
// surface "L1 has data but L2 mirror failed" hints.
func WithSignalStore(s *signal.Store) DevToolsOption {
	return func(h *DevToolsHandler) { h.signalStore = s }
}

// NewDevToolsHandler creates a developer tools handler with optional dependencies.
func NewDevToolsHandler(tc *tesla.Client, opts ...DevToolsOption) *DevToolsHandler {
	h := &DevToolsHandler{teslaClient: tc}
	for _, opt := range opts {
		opt(h)
	}
	if h.db != nil {
		h.settingsRepo = settingsdb.NewSettingsRepo(h.db)
		h.vehicleRepo = vehicledb.NewVehicleRepo(h.db)
	}
	return h
}

// DetectRegion calls the Tesla Fleet API to detect the user's region.
func (h *DevToolsHandler) DetectRegion(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusPreconditionFailed, "Tesla account not connected. Please authenticate first.")
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
		httpx.WriteError(w, http.StatusBadRequest, "domain is required")
		return
	}

	partnerToken, err := h.teslaClient.GetPartnerToken(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get partner token")
		httpx.WriteJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":   "Failed to obtain partner token",
			"details": err.Error(),
		})
		return
	}

	data, status, err := h.teslaClient.RegisterPartner(r.Context(), partnerToken, req.Domain)
	if err != nil {
		log.Warn().Err(err).Int("status", status).Msg("partner registration failed")
	}

	w.Header().Set("Content-Type", "application/json")
	if data != nil && isJSON(data) {
		w.WriteHeader(status)
		w.Write(data)
	} else {
		// Tesla may return HTML on auth errors; wrap it for the SPA.
		errMsg := "Registration request failed"
		details := "Tesla returned a non-JSON response (likely an auth redirect or error page)"
		if err != nil {
			details = err.Error()
		}
		if status == 0 {
			status = http.StatusBadGateway
		}
		httpx.WriteJSON(w, status, map[string]interface{}{
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
		httpx.WriteError(w, http.StatusBadRequest, "domain query parameter is required")
		return
	}

	data, status, err := h.teslaClient.GetPartnerPublicKey(r.Context(), domain)
	if err != nil {
		log.Warn().Err(err).Int("status", status).Str("domain", domain).Msg("partner public key fetch failed")
	}

	w.Header().Set("Content-Type", "application/json")
	if data != nil && isJSON(data) {
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
		httpx.WriteJSON(w, status, map[string]interface{}{
			"error":       errMsg,
			"details":     details,
			"status_code": status,
		})
	}
}

// FleetAPIInfo returns current Fleet API configuration details.
func (h *DevToolsHandler) FleetAPIInfo(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
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

// TestAPIConnectivity tests whether the Tesla Fleet API base URL is reachable.
func (h *DevToolsHandler) TestAPIConnectivity(w http.ResponseWriter, r *http.Request) {
	baseURL := h.teslaClient.BaseURL()

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodHead, baseURL, nil)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to build request: "+err.Error())
		return
	}

	start := time.Now()
	// devtools-tile-probe is the prompt-mandated service tag for the
	// outbound HEAD probe of the Tesla Fleet API base URL. Constructed
	// per-call so the latest SetOutboundSink wiring is honoured.
	probeClient := httputil.NewClient(httputil.ClientConfig{
		Name:          "devtools-tile-probe",
		Timeout:       10 * time.Second,
		Sink:          currentSink(),
		EnableLogging: true,
	})
	resp, err := probeClient.Do(req)
	latency := time.Since(start)

	if err != nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"reachable":  false,
			"base_url":   baseURL,
			"error":      err.Error(),
			"latency_ms": latency.Milliseconds(),
		})
		return
	}
	defer resp.Body.Close()

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
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

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"has_valid_token": valid,
		"client_id":       h.teslaClient.ClientID(),
	})
}

// MQTTTest publishes a test message and reports MQTT connectivity status.
func (h *DevToolsHandler) MQTTTest(w http.ResponseWriter, r *http.Request) {
	if h.mqttClient == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "MQTT client not configured")
		return
	}

	connected := h.mqttClient.IsConnected()
	if !connected {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"connected": false,
			"message":   "MQTT client is not connected",
		})
		return
	}

	topic := "teslasync/dev-tools/ping"
	payload := fmt.Sprintf(`{"timestamp":"%s","source":"dev-tools"}`, time.Now().UTC().Format(time.RFC3339))
	h.mqttClient.Publish(topic, payload)

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"connected": true,
		"topic":     topic,
		"payload":   payload,
		"message":   "test message published",
	})
}

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

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
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

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
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

// GenerateKeypair generates an ECDSA P-256 keypair, stores the public key in DB,
// and returns the private key ONE TIME (never stored).
func (h *DevToolsHandler) GenerateKeypair(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "database not available")
		return
	}

	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to generate keypair")
		return
	}

	privBytes, err := x509.MarshalECPrivateKey(privateKey)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to marshal private key")
		return
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: privBytes})

	pubBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to marshal public key")
		return
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubBytes})

	hash := sha256.Sum256(pubBytes)
	fingerprint := fmt.Sprintf("%x", hash)

	_, err = h.db.Pool.Exec(r.Context(),
		`INSERT INTO tesla_public_key (id, public_key_pem, fingerprint, created_at)
		 VALUES (1, $1, $2, NOW())
		 ON CONFLICT (id) DO UPDATE SET public_key_pem = $1, fingerprint = $2, created_at = NOW()`,
		string(pubPEM), fingerprint)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to store public key: "+err.Error())
		return
	}

	log.Info().Str("fingerprint", fingerprint).Msg("generated new Tesla keypair")

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"private_key_pem": string(privPEM),
		"public_key_pem":  string(pubPEM),
		"fingerprint":     fingerprint,
		"warning":         "Save the private key now. It will NOT be shown again.",
	})
}

// UploadPublicKey accepts a PEM-encoded public key and stores it.
func (h *DevToolsHandler) UploadPublicKey(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "database not available")
		return
	}

	var req struct {
		PublicKeyPEM string `json:"public_key_pem"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PublicKeyPEM == "" {
		httpx.WriteError(w, http.StatusBadRequest, "public_key_pem is required")
		return
	}

	block, _ := pem.Decode([]byte(req.PublicKeyPEM))
	if block == nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid PEM format")
		return
	}
	pubKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid public key: "+err.Error())
		return
	}

	if _, ok := pubKey.(*ecdsa.PublicKey); !ok {
		httpx.WriteError(w, http.StatusBadRequest, "key must be an ECDSA public key (P-256)")
		return
	}

	hash := sha256.Sum256(block.Bytes)
	fingerprint := fmt.Sprintf("%x", hash)

	_, err = h.db.Pool.Exec(r.Context(),
		`INSERT INTO tesla_public_key (id, public_key_pem, fingerprint, created_at)
		 VALUES (1, $1, $2, NOW())
		 ON CONFLICT (id) DO UPDATE SET public_key_pem = $1, fingerprint = $2, created_at = NOW()`,
		req.PublicKeyPEM, fingerprint)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to store public key")
		return
	}

	log.Info().Str("fingerprint", fingerprint).Msg("uploaded Tesla public key")

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "stored",
		"fingerprint": fingerprint,
	})
}

// PublicKeyStatus returns the current public key status.
func (h *DevToolsHandler) PublicKeyStatus(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{"configured": false})
		return
	}

	var pubPEM, fingerprint string
	var createdAt time.Time
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT public_key_pem, fingerprint, created_at FROM tesla_public_key WHERE id = 1`,
	).Scan(&pubPEM, &fingerprint, &createdAt)

	if err != nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"configured":      false,
			"well_known_path": "/.well-known/appspecific/com.tesla.3p.public-key.pem",
		})
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
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
		httpx.WriteError(w, http.StatusInternalServerError, "database not available")
		return
	}

	_, err := h.db.Pool.Exec(r.Context(), `DELETE FROM tesla_public_key WHERE id = 1`)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete public key")
		return
	}

	log.Info().Msg("deleted Tesla public key")
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{"status": "deleted"})
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
		httpx.WriteError(w, http.StatusInternalServerError, "database not available")
		return
	}
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusPreconditionFailed, "Tesla account not connected")
		return
	}

	var req struct {
		VIN string `json:"vin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.VIN == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vin is required")
		return
	}

	var pubPEM string
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT public_key_pem FROM tesla_public_key WHERE id = 1`,
	).Scan(&pubPEM)
	if err != nil {
		httpx.WriteError(w, http.StatusPreconditionFailed, "no public key configured — generate one in Dev Tools first")
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

func isJSON(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	for _, b := range data {
		if b == ' ' || b == '\t' || b == '\n' || b == '\r' {
			continue
		}
		return b == '{' || b == '[' || b == '"'
	}
	return false
}

// FleetTelemetrySubscribe configures vehicles to stream telemetry data.
// POST /api/v1/dev-tools/fleet-telemetry-subscribe
func (h *DevToolsHandler) FleetTelemetrySubscribe(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusPreconditionFailed, "Tesla account not connected")
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
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.VINs) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "at least one VIN is required")
		return
	}
	if req.Hostname == "" {
		if h.cfg != nil && h.cfg.FleetTelemetry.Host != "" {
			req.Hostname = h.cfg.FleetTelemetry.Host
		} else {
			httpx.WriteError(w, http.StatusBadRequest, "hostname is required (or set FLEET_TELEMETRY_HOST)")
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

	fields := make(map[string]tesla.FleetTelemetryField)
	if len(req.Fields) == 0 {
		req.Fields = []string{
			"VehicleSpeed", "Odometer", "Soc", "BatteryLevel",
			"Location", "GpsHeading",
			"ChargeState", "ChargeLimitSoc",
			"InsideTemp", "OutsideTemp",
			"Locked", "SentryMode",
		}
	}
	for _, f := range req.Fields {
		interval := req.Interval
		if perSignal, ok := req.FieldIntervals[f]; ok {
			interval = perSignal
		}
		fields[f] = fleetTelemetryFieldWithPolicy(f, interval)
	}

	var caValue string
	if ca := strings.TrimSpace(req.CA); ca != "" {
		caValue = ca
	} else {
		// Tesla requires the Fleet Telemetry server's trusted root CA.
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
		httpx.WriteJSON(w, status, map[string]interface{}{
			"error":   errMsg,
			"details": details,
		})
	}
}

func fleetTelemetryFieldWithPolicy(fieldName string, interval int) tesla.FleetTelemetryField {
	field := tesla.FleetTelemetryField{IntervalSeconds: interval}
	if policy, ok := teslaconfig.PolicyFor(fieldName); ok {
		field.MinimumDelta = policy.MinimumDelta
		field.IncludeFields = policy.IncludeFields
	}
	return field
}

// FleetTelemetryGetConfig returns the fleet telemetry configuration for a vehicle.
// GET /api/v1/dev-tools/fleet-telemetry-config?vin=...
func (h *DevToolsHandler) FleetTelemetryGetConfig(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusPreconditionFailed, "Tesla account not connected")
		return
	}

	vin := r.URL.Query().Get("vin")
	if vin == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vin query parameter is required")
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
		httpx.WriteJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":   "Failed to fetch fleet telemetry config",
			"details": errStringOrDefault(err, "non-JSON response from Tesla"),
		})
	}
}

// FleetTelemetryDeleteConfig removes fleet telemetry configuration for a vehicle.
// DELETE /api/v1/dev-tools/fleet-telemetry-config?vin=...
func (h *DevToolsHandler) FleetTelemetryDeleteConfig(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusPreconditionFailed, "Tesla account not connected")
		return
	}

	vin := r.URL.Query().Get("vin")
	if vin == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vin query parameter is required")
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
		httpx.WriteJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":   "Failed to delete fleet telemetry config",
			"details": errStringOrDefault(err, "non-JSON response from Tesla"),
		})
	}
}

// FleetTelemetryErrors returns recent fleet telemetry errors for a vehicle.
// GET /api/v1/dev-tools/fleet-telemetry-errors?vin=...
func (h *DevToolsHandler) FleetTelemetryErrors(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusPreconditionFailed, "Tesla account not connected")
		return
	}

	vin := r.URL.Query().Get("vin")
	if vin == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vin query parameter is required")
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
		httpx.WriteJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":   "Failed to fetch fleet telemetry errors",
			"details": errStringOrDefault(err, "non-JSON response from Tesla"),
		})
	}
}

// FleetStatus provides fleet information for vehicles.
// POST /api/v1/dev-tools/fleet-status
func (h *DevToolsHandler) FleetStatus(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusPreconditionFailed, "Tesla account not connected")
		return
	}

	var req struct {
		VINs []string `json:"vins"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.VINs) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vins array is required")
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
		httpx.WriteJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":   "Failed to fetch fleet status",
			"details": errStringOrDefault(err, "non-JSON response from Tesla"),
		})
	}
}

// NearbyChargingSites returns charging sites near the vehicle.
func (h *DevToolsHandler) NearbyChargingSites(w http.ResponseWriter, r *http.Request) {
	vin := r.URL.Query().Get("vin")
	if vin == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vin is required")
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
		httpx.WriteError(w, http.StatusBadRequest, "vin is required")
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
		httpx.WriteError(w, http.StatusBadRequest, "vin is required")
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
		httpx.WriteError(w, http.StatusBadRequest, "vin is required")
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

// redisSignalsMeta is the diagnostic block returned alongside RedisSignals.
// Each field maps to one of the five empty-state root causes the viewer
// page needs to distinguish (mode-local, mirror-failed, TTL-expired,
// never-streamed, VIN-mismatch).
type redisSignalsMeta struct {
	LiveSignalStoreMode string     `json:"live_signal_store_mode"`
	RedisKey            string     `json:"redis_key"`
	RedisFieldCount     int        `json:"redis_field_count"`
	L1SignalCount       int        `json:"l1_signal_count"`
	L1LastSeenAt        *time.Time `json:"l1_last_seen_at,omitempty"`
	L2LastSeenAt        *time.Time `json:"l2_last_seen_at,omitempty"`
	VehicleVIN          string     `json:"vehicle_vin,omitempty"`
}

// RedisSignals returns all cached signal values from Redis for a vehicle,
// alongside a diagnostic meta block (mode, raw HSET size, L1 size,
// L1/L2 last-seen, VIN) so the viewer page can render structured empty
// states instead of a generic "no signals cached" message.
//
// GET /api/v1/dev-tools/redis-signals?vehicle_id=X
func (h *DevToolsHandler) RedisSignals(w http.ResponseWriter, r *http.Request) {
	if h.redisCache == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "Redis signal cache is not available")
		return
	}

	vidStr := r.URL.Query().Get("vehicle_id")
	if vidStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id query parameter is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}

	ctx := r.Context()

	// L2: HGETALL + decode (existing path).
	signals, err := h.redisCache.GetAll(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("redis signal cache: GetAll failed")
		httpx.WriteError(w, http.StatusServiceUnavailable, "Redis is unreachable")
		return
	}

	// L2: timestamped values for l2_last_seen_at; bypass on decode error
	// so meta degrades gracefully (the user-visible signals payload still
	// returns).
	var l2LastSeen *time.Time
	if values, vErr := h.redisCache.GetAllValues(ctx, vehicleID); vErr == nil {
		if t := newestRedisSignalTime(values); !t.IsZero() {
			tCopy := t
			l2LastSeen = &tCopy
		}
	}

	// L2: raw HSET size (HLEN) — distinguishes "Redis empty" from
	// "Redis has fields the decoder couldn't parse".
	rawCount, _ := h.redisCache.RawFieldCount(ctx, vehicleID)

	// L1: in-process Store snapshot. signalStore may be nil in builds
	// that don't wire it (zero values for the diagnostic).
	var (
		l1Count    int
		l1LastSeen *time.Time
	)
	if h.signalStore != nil {
		all := h.signalStore.GetAll(vehicleID)
		l1Count = len(all)
		if t := h.signalStore.LastSeenAt(vehicleID); !t.IsZero() {
			tCopy := t
			l1LastSeen = &tCopy
		}
	}

	// VIN lookup — degrades to "" on missing repo or missing vehicle.
	var vin string
	if h.vehicleRepo != nil {
		if veh, vErr := h.vehicleRepo.GetByID(ctx, vehicleID); vErr == nil && veh != nil {
			vin = veh.VIN
		}
	}

	mode := "hybrid"
	if h.cfg != nil && h.cfg.FleetTelemetry.LiveSignalStoreMode != "" {
		mode = h.cfg.FleetTelemetry.LiveSignalStoreMode
	}

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

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":   vehicleID,
		"signal_count": len(result),
		"signals":      result,
		"meta": redisSignalsMeta{
			LiveSignalStoreMode: mode,
			RedisKey:            fmt.Sprintf("vehicle:%d:signals", vehicleID),
			RedisFieldCount:     rawCount,
			L1SignalCount:       l1Count,
			L1LastSeenAt:        l1LastSeen,
			L2LastSeenAt:        l2LastSeen,
			VehicleVIN:          vin,
		},
	})
}

// newestRedisSignalTime returns the maximum non-zero Timestamp across
// the Redis L2 envelope values map, or the zero time when every value
// is legacy (zero Timestamp) or the map is empty.
func newestRedisSignalTime(values map[string]*signal.Value) time.Time {
	var newest time.Time
	for _, v := range values {
		if v == nil {
			continue
		}
		if v.Timestamp.After(newest) {
			newest = v.Timestamp
		}
	}
	return newest
}

// RedisSignalKeys returns the list of vehicleIDs that have a populated
// Redis HSET, paired with their raw field counts and (when available)
// VIN + display_name. Used by the Redis Signal Viewer's empty-state
// diagnostic to surface "other vehicles have data" hints when the
// selected vehicle's HSET is empty.
//
// GET /api/v1/dev-tools/redis-signals/keys?limit=50
func (h *DevToolsHandler) RedisSignalKeys(w http.ResponseWriter, r *http.Request) {
	if h.redisCache == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "Redis signal cache is not available")
		return
	}

	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}

	ids, err := h.redisCache.ScanVehicleKeys(r.Context(), limit)
	if err != nil {
		log.Error().Err(err).Msg("redis signal cache: ScanVehicleKeys failed")
		httpx.WriteError(w, http.StatusServiceUnavailable, "Redis is unreachable")
		return
	}

	type keyEntry struct {
		VehicleID   int64  `json:"vehicle_id"`
		FieldCount  int    `json:"field_count"`
		VehicleVIN  string `json:"vehicle_vin,omitempty"`
		DisplayName string `json:"display_name,omitempty"`
	}
	out := make([]keyEntry, 0, len(ids))
	for _, id := range ids {
		fc, _ := h.redisCache.RawFieldCount(r.Context(), id)
		entry := keyEntry{VehicleID: id, FieldCount: fc}
		if h.vehicleRepo != nil {
			if veh, vErr := h.vehicleRepo.GetByID(r.Context(), id); vErr == nil && veh != nil {
				entry.VehicleVIN = veh.VIN
				entry.DisplayName = veh.DisplayName
			}
		}
		out = append(out, entry)
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"keys":  out,
		"total": len(out),
	})
}

// RedisSignalsPurge deletes the Redis HSET for a single vehicle.
//
// DELETE /api/v1/dev-tools/redis-signals?vehicle_id=X
//
// Response: {"vehicle_id": X, "purged": true|false} where `purged`
// indicates whether the key existed (true) or there was nothing to
// delete (false). Both cases are 200 OK because the destructive intent
// "ensure this vehicle's L2 cache is empty" is satisfied either way.
//
// The L1 in-process Store is NOT touched here — it lives in each pod's
// memory and naturally drifts back into sync as new fleet telemetry
// arrives. The frontend's confirm dialog explains this to operators so
// they don't expect cluster-wide L1 invalidation.
func (h *DevToolsHandler) RedisSignalsPurge(w http.ResponseWriter, r *http.Request) {
	if h.redisCache == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "Redis signal cache is not available")
		return
	}

	vidStr := r.URL.Query().Get("vehicle_id")
	if vidStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id query parameter is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}

	purged, err := h.redisCache.Purge(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("redis signal cache: Purge failed")
		httpx.WriteError(w, http.StatusServiceUnavailable, "Redis is unreachable")
		return
	}

	log.Info().Int64("vehicle_id", vehicleID).Bool("purged", purged).Msg("redis signal cache: purged")
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"purged":     purged,
	})
}

// RedisSignalsPurgeAll deletes every vehicle:*:signals HSET reachable
// via SCAN.
//
// DELETE /api/v1/dev-tools/redis-signals/keys
//
// Response: {"purged": N, "scanned": M, "has_more": bool, "limit": L}
// where:
//   - purged: number of HSETs DEL actually removed
//   - scanned: number of HSETs SCAN found in this batch
//   - limit: the per-batch SCAN cap (1000)
//   - has_more: true when scanned == limit (more keys likely exist
//     outside this batch — call again to drain).
//
// The L1 in-process Store is NOT touched (see RedisSignalsPurge for
// rationale).
func (h *DevToolsHandler) RedisSignalsPurgeAll(w http.ResponseWriter, r *http.Request) {
	if h.redisCache == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "Redis signal cache is not available")
		return
	}

	const limit = 1000
	purged, scanned, err := h.redisCache.PurgeAll(r.Context(), limit)
	if err != nil {
		log.Error().Err(err).Msg("redis signal cache: PurgeAll failed")
		httpx.WriteError(w, http.StatusServiceUnavailable, "Redis is unreachable")
		return
	}

	hasMore := scanned >= limit
	log.Warn().
		Int("purged", purged).
		Int("scanned", scanned).
		Bool("has_more", hasMore).
		Msg("redis signal cache: bulk purge")
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"purged":   purged,
		"scanned":  scanned,
		"limit":    limit,
		"has_more": hasMore,
	})
}
