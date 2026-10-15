package guard

import (
	"context"
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/go-chi/chi/v5"
)

type fakeGuardConfigs struct {
	saved         *vehiclemodel.GuardConfig
	loadErr       error
	saveErr       error
	geofenceErr   error
	geofenceFound bool
	writes        int
}

type fakeGuardAPIPolicy struct {
	suspended bool
	err       error
}

func (f fakeGuardAPIPolicy) IsAPISuspended(context.Context) (bool, error) {
	return f.suspended, f.err
}

func (f *fakeGuardConfigs) GetConfig(context.Context, int64) (*vehiclemodel.GuardConfig, error) {
	return f.saved, f.loadErr
}

func (f *fakeGuardConfigs) UpsertConfig(ctx context.Context, cfg *vehiclemodel.GuardConfig) (*vehiclemodel.GuardConfig, error) {
	f.writes++
	if f.saveErr != nil {
		return nil, f.saveErr
	}
	cfg.CreatedAt = time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	cfg.UpdatedAt = cfg.CreatedAt
	f.saved = cfg
	return cfg, nil
}

func (f *fakeGuardConfigs) GeofenceExists(context.Context, int64) (bool, error) {
	return f.geofenceFound, f.geofenceErr
}

const validGuardConfigBody = `{"enabled":false,"home_geofence_id":null,"sensitivity":"medium","auto_panic":false}`

func configTestHandler(configs *fakeGuardConfigs) (*GuardHandler, *fakeGuardCommandClient) {
	cmd := &fakeGuardCommandClient{}
	return &GuardHandler{
		repo:    &fakeGuardRepo{exists: map[int64]bool{42: true}},
		configs: configs,
		vehicles: &fakeGuardVehicles{byID: map[int64]*vehiclemodel.Vehicle{
			42: {ID: 42, VIN: "TEST_ONLY_NOT_A_VEHICLE"},
		}},
		cmd: cmd, commandProxyConfigured: true, apiPolicy: fakeGuardAPIPolicy{},
	}, cmd
}

func TestGuardSetConfigValidation(t *testing.T) {
	for _, body := range []string{
		``, `{`, `null`, `{}`, `[]`,
		`{"enabled":null,"auto_panic":false,"sensitivity":"medium"}`,
		`{"enabled":false,"auto_panic":"false","sensitivity":"medium"}`,
		strings.Replace(validGuardConfigBody, `"medium"`, `"invalid"`, 1),
		strings.Replace(validGuardConfigBody, `null`, `0`, 1),
		strings.Replace(validGuardConfigBody, `null`, `-1`, 1),
		strings.Replace(validGuardConfigBody, `null`, `1.5`, 1),
		strings.Replace(validGuardConfigBody, `"enabled":false`, `"unknown":true,"enabled":false`, 1),
		validGuardConfigBody + `{}`,
		validGuardConfigBody + strings.Repeat(" ", 4096),
	} {
		t.Run(body, func(t *testing.T) {
			cfg := &fakeGuardConfigs{}
			h, cmd := configTestHandler(cfg)
			req := guardRequest(http.MethodPost, "/vehicles/42/guard", "42", "")
			req.Body = io.NopCloser(strings.NewReader(body))
			rec := httptest.NewRecorder()
			h.SetConfig(rec, req)
			if rec.Code != http.StatusBadRequest || cfg.writes != 0 || len(cmd.gotCalls) != 0 {
				t.Fatalf("status=%d writes=%d commands=%v body=%s", rec.Code, cfg.writes, cmd.gotCalls, rec.Body)
			}
		})
	}
	for _, id := range []string{"", "0", "-1", "abc", "9223372036854775808"} {
		h, _ := configTestHandler(&fakeGuardConfigs{})
		rec := httptest.NewRecorder()
		h.SetConfig(rec, guardRequest(http.MethodPost, "/", id, ""))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("id=%q status=%d", id, rec.Code)
		}
	}
}

func TestGuardSetConfigSaveAndArm(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		cfg := &fakeGuardConfigs{}
		h, cmd := configTestHandler(cfg)
		body := strings.Replace(validGuardConfigBody, `"enabled":false`, `"enabled":true`, 1)
		if !enabled {
			body = validGuardConfigBody
		}
		req := guardRequest(http.MethodPost, "/vehicles/42/guard", "42", "")
		req.Body = io.NopCloser(strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.SetConfig(rec, req)
		var resp SetGuardConfigResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if rec.Code != http.StatusOK || cfg.writes != 1 || resp.Config.Enabled != enabled ||
			resp.Config.VehicleID != 42 || resp.Config.CreatedAt.IsZero() || resp.Config.HomeGeofenceID != nil {
			t.Fatalf("status=%d response=%+v", rec.Code, resp)
		}
		if enabled {
			if len(cmd.gotCalls) != 2 || cmd.gotCalls[0].command != "lock" || cmd.gotCalls[1].command != "sentry_on" {
				t.Fatalf("arming order = %v", cmd.gotCalls)
			}
		} else if len(cmd.gotCalls) != 0 {
			t.Fatalf("disabling policy must not mutate vehicle: %v", cmd.gotCalls)
		}
	}
}

func TestGuardSetConfigFailures(t *testing.T) {
	tests := []struct {
		name                     string
		setup                    func(*GuardHandler, *fakeGuardConfigs, *fakeGuardCommandClient)
		body                     string
		status, writes, commands int
	}{
		{"unknown vehicle", func(h *GuardHandler, _ *fakeGuardConfigs, _ *fakeGuardCommandClient) {
			h.vehicles = &fakeGuardVehicles{}
		}, validGuardConfigBody, 404, 0, 0},
		{"lookup error", func(h *GuardHandler, _ *fakeGuardConfigs, _ *fakeGuardCommandClient) {
			h.vehicles = &fakeGuardVehicles{getErr: errors.New("db unavailable")}
		}, validGuardConfigBody, 500, 0, 0},
		{"geofence missing", func(*GuardHandler, *fakeGuardConfigs, *fakeGuardCommandClient) {},
			strings.Replace(validGuardConfigBody, "null", "9", 1), 400, 0, 0},
		{"geofence error", func(_ *GuardHandler, cfg *fakeGuardConfigs, _ *fakeGuardCommandClient) {
			cfg.geofenceErr = errors.New("db unavailable")
		}, strings.Replace(validGuardConfigBody, "null", "9", 1), 500, 0, 0},
		{"save error", func(_ *GuardHandler, cfg *fakeGuardConfigs, _ *fakeGuardCommandClient) {
			cfg.saveErr = errors.New("db unavailable")
		}, validGuardConfigBody, 500, 1, 0},
		{"proxy absent", func(h *GuardHandler, _ *fakeGuardConfigs, _ *fakeGuardCommandClient) {
			h.commandProxyConfigured = false
		}, strings.Replace(validGuardConfigBody, `"enabled":false`, `"enabled":true`, 1), 501, 0, 0},
		{"API suspended", func(h *GuardHandler, _ *fakeGuardConfigs, _ *fakeGuardCommandClient) {
			h.apiPolicy = fakeGuardAPIPolicy{suspended: true}
		}, strings.Replace(validGuardConfigBody, `"enabled":false`, `"enabled":true`, 1), 409, 0, 0},
		{"API policy unavailable", func(h *GuardHandler, _ *fakeGuardConfigs, _ *fakeGuardCommandClient) {
			h.apiPolicy = fakeGuardAPIPolicy{err: errors.New("db unavailable")}
		}, strings.Replace(validGuardConfigBody, `"enabled":false`, `"enabled":true`, 1), 500, 0, 0},
		{"partial arming failure", func(_ *GuardHandler, _ *fakeGuardConfigs, cmd *fakeGuardCommandClient) {
			cmd.errByCommand = map[string]error{"lock": errors.New("secret upstream detail")}
		}, strings.Replace(validGuardConfigBody, `"enabled":false`, `"enabled":true`, 1), 502, 1, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &fakeGuardConfigs{}
			h, cmd := configTestHandler(cfg)
			tt.setup(h, cfg, cmd)
			req := guardRequest(http.MethodPost, "/vehicles/42/guard", "42", "")
			req.Body = io.NopCloser(strings.NewReader(tt.body))
			rec := httptest.NewRecorder()
			h.SetConfig(rec, req)
			if rec.Code != tt.status || cfg.writes != tt.writes || len(cmd.gotCalls) != tt.commands {
				t.Fatalf("status=%d writes=%d commands=%v body=%s", rec.Code, cfg.writes, cmd.gotCalls, rec.Body)
			}
			if strings.Contains(rec.Body.String(), "secret upstream") {
				t.Fatal("upstream detail leaked")
			}
		})
	}
}

func TestGuardConfigRead(t *testing.T) {
	cfg := &fakeGuardConfigs{}
	h, _ := configTestHandler(cfg)
	rec := httptest.NewRecorder()
	h.Config(rec, guardRequest(http.MethodGet, "/vehicles/42/guard/config", "42", ""))
	if rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != "null" {
		t.Fatalf("unsaved config must be null: %d %s", rec.Code, rec.Body)
	}
	cfg.loadErr = errors.New("db unavailable")
	rec = httptest.NewRecorder()
	h.Config(rec, guardRequest(http.MethodGet, "/vehicles/42/guard/config", "42", ""))
	if rec.Code != 500 {
		t.Fatalf("read error status=%d", rec.Code)
	}
}

type guardMountedRoute struct {
	method, path, handler string
}

// Read method, enclosing path groups and handler from the production AST.
// Unlike verify.sh, this never discards HTTP methods. This test-only reader
// cannot register a route that is absent from the actual composition source.
func productionGuardRoutes(t *testing.T) []guardMountedRoute {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), "../router.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var routes []guardMountedRoute
	var visit func(ast.Node, string)
	visit = func(node ast.Node, prefix string) {
		ast.Inspect(node, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || len(call.Args) != 2 {
				return true
			}
			method, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			literal, ok := call.Args[0].(*ast.BasicLit)
			if !ok || literal.Kind != token.STRING {
				return true
			}
			path, err := strconv.Unquote(literal.Value)
			if err != nil {
				t.Fatal(err)
			}
			fullPath := strings.TrimRight(prefix, "/") + path
			if method.Sel.Name == "Route" {
				if group, ok := call.Args[1].(*ast.FuncLit); ok {
					visit(group.Body, fullPath)
					return false
				}
				return true
			}
			if !strings.HasPrefix(fullPath, "/api/v1/vehicles/{vehicleID}/guard") {
				return true
			}
			handler, ok := call.Args[1].(*ast.SelectorExpr)
			if !ok {
				return true
			}
			owner, ok := handler.X.(*ast.Ident)
			if !ok || owner.Name != "guardHandler" {
				return true
			}
			routes = append(routes, guardMountedRoute{
				method:  strings.ToUpper(method.Sel.Name),
				path:    strings.TrimRight(fullPath, "/"),
				handler: handler.Sel.Name,
			})
			return true
		})
	}
	visit(file, "")
	return routes
}

func TestGuardConfigMountedRouteContract(t *testing.T) {
	routes := productionGuardRoutes(t)
	want := guardMountedRoute{http.MethodPost, "/api/v1/vehicles/{vehicleID}/guard", "SetConfig"}
	found := 0
	for _, route := range routes {
		if route == want {
			found++
		}
	}
	if found != 1 {
		t.Fatalf("exact POST/path/SetConfig registrations=%d, want 1; actual=%+v", found, routes)
	}

	// Middleware source assertion supplements the executable dispatch test;
	// it is not used as a substitute for method-aware route validation.
	source, err := os.ReadFile("../router.go")
	if err != nil {
		t.Fatal(err)
	}

	start := strings.Index(string(source), `r.Route("/guard", func(r chi.Router) {`)
	if start < 0 {
		t.Fatal("guard subtree missing")
	}
	block := string(source)[start:]
	end := strings.Index(block, "\n\t\t\t\t})")
	if end < 0 {
		t.Fatal("guard subtree boundary missing")
	}
	block = block[:end]
	for _, route := range []string{
		`r.Get("/", guardHandler.Status)`,
		`r.Get("/config", guardHandler.Config)`,
		`r.With(httprate.LimitByIP(5, 1*time.Minute), RequireSudo(sudoStore, sudoCfg)).Post("/", guardHandler.SetConfig)`,
		`r.Get("/events", guardHandler.Events)`,
	} {
		if !strings.Contains(block, route) {
			t.Fatalf("production guard routes missing %s", route)
		}
	}
}

// Exercise the real handler behind method/path/handler registrations read
// from router.go, not an independently invented POST registration. Only DB,
// command and API policy boundaries are fake. Production auth/sudo middleware
// is not executed in this isolated test; its registration is pinned above.
func TestGuardConfigProductionMethodDispatch(t *testing.T) {
	routes := productionGuardRoutes(t)
	for _, tt := range []struct {
		name, method, path, body string
		status, writes           int
	}{
		{"POST saves config", http.MethodPost, "/api/v1/vehicles/42/guard", validGuardConfigBody, 200, 1},
		{"POST validates body", http.MethodPost, "/api/v1/vehicles/42/guard", `{}`, 400, 0},
		{"POST validates vehicle ID", http.MethodPost, "/api/v1/vehicles/0/guard", validGuardConfigBody, 400, 0},
		{"GET is telemetry not a write", http.MethodGet, "/api/v1/vehicles/42/guard", validGuardConfigBody, 200, 0},
		{"PUT cannot write config", http.MethodPut, "/api/v1/vehicles/42/guard", validGuardConfigBody, 405, 0},
		{"POST to read-only config path cannot write", http.MethodPost, "/api/v1/vehicles/42/guard/config", validGuardConfigBody, 405, 0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &fakeGuardConfigs{}
			h, cmd := configTestHandler(cfg)
			handlers := map[string]http.HandlerFunc{
				"SetConfig": h.SetConfig, "Config": h.Config, "Status": h.Status,
				"Events": h.Events, "Acknowledge": h.Acknowledge, "Panic": h.Panic,
			}
			router := chi.NewRouter()
			for _, route := range routes {
				handler, ok := handlers[route.handler]
				if !ok {
					t.Fatalf("unexpected production guard handler %q", route.handler)
				}
				router.Method(route.method, route.path, handler)
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body)))
			if rec.Code != tt.status || cfg.writes != tt.writes {
				t.Fatalf("%s %s: status=%d writes=%d body=%s", tt.method, tt.path, rec.Code, cfg.writes, rec.Body)
			}
			if len(cmd.gotCalls) != 0 {
				t.Fatalf("disabled-policy route test must send no commands: %v", cmd.gotCalls)
			}
			if tt.writes == 1 {
				var response SetGuardConfigResponse
				if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				if response.Config == nil || response.Config.VehicleID != 42 || response.Config.Enabled {
					t.Fatalf("POST did not dispatch to the typed config writer: %+v", response)
				}
			}
		})
	}
}
