package smartreadiness_test

import (
	"fmt"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc"
	packetsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/trippacket"
	"github.com/ev-dev-labs/teslasync/internal/database"
	ownershipdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel"
	packetdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel/trippacket"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/trippacket"
	ownershiphandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/trippacket"
	"github.com/go-chi/chi/v5"
)

const packetEndpoint = "/api/v1/ownership/trip-packet"
const packetPath = packetEndpoint + "?vehicle_id=7"

var packetEarly = time.Date(2026, 4, 2, 12, 59, 0, 0, time.UTC)

func packetRouter(db *database.DB, now func() time.Time, header string) http.Handler {
	svc := ownershipintelsvc.New(ownershipdb.NewSourceRepository(db), ownershipdb.NewDurableRepository(db))
	router := chi.NewRouter()
	router.Route("/api/v1", ownershiphandler.NewHandler(svc, header).
		WithTripPackets(packetsvc.NewReviews(packetdb.NewRepository(db.Pool), now)).MountRoutes)
	return router
}

func seedTripPacket(t *testing.T) *database.DB {
	t.Helper()
	_, db := testRepository(t)
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO vehicles(id,display_name) VALUES (8,'Other synthetic vehicle');
		CREATE TABLE drives (
		    id bigint PRIMARY KEY,vehicle_id bigint NOT NULL,started_at timestamptz NOT NULL,
		    ended_at timestamptz,distance_m double precision
		);
		INSERT INTO drives VALUES
		    (801,7,'2026-03-10T03:45:00Z','2026-03-10T05:05:00Z',11250),
		    (802,7,'2026-03-12T10:00:00Z','2026-03-12T10:20:00Z',5000),
		    (803,8,'2026-03-09T10:00:00Z','2026-03-09T10:20:00Z',9000),
		    (804,7,'2026-04-01T04:00:00Z','2026-04-01T04:30:00Z',4000),
		    (805,7,'2026-03-31T23:00:00Z',NULL,NULL);`); err != nil {
		t.Fatal(err)
	}
	applyWarrantyFixtureMigration(t, db, "000301_smart_trip_packets.up")
	return db
}

func packetInput(v domain.Version) map[string]any {
	return map[string]any{"plan_id": v.ID, "expected_revision": v.Revision}
}

func TestTripPacketPublishesOnlyConfirmedBusinessAndExportsCurrentEvidence(t *testing.T) {
	now := packetEarly
	clock := func() time.Time { return now }
	db := seedTripPacket(t)
	router := packetRouter(db, clock, "X-Test-Subject")
	repo := packetdb.NewRepository(db.Pool)
	read := func(path, subject string) domain.Review {
		t.Helper()
		return invoiceRequest[domain.Review](t, router, http.MethodGet, path, subject, "", nil, http.StatusOK)
	}
	if got := read(packetPath, mediaOwner); got.Plan != nil || got.Packet != nil {
		t.Fatal("private packet was not default off")
	}
	run := packetsvc.NewReviews(repo, clock)
	if got, err := run.ProcessDue(t.Context(), 4); err != nil || len(got.Outcomes) != 0 {
		t.Fatalf("disabled scope was evaluated: %+v %v", got, err)
	}
	consent := map[string]any{"plan_id": 0, "expected_revision": 0, "time_zone": "America/New_York", "confirmed": true}
	invoiceRequest[struct{}](t, packetRouter(db, clock, ""), http.MethodPut, packetPath, "", "open", consent, http.StatusForbidden)
	invoiceRequest[struct{}](t, router, http.MethodPut, packetPath, mediaOwner, "subject:"+mediaOther, consent, http.StatusConflict)
	invoiceRequest[struct{}](t, router, http.MethodPut, packetPath, mediaOwner, "", consent, http.StatusNoContent)
	if got, err := run.ProcessDue(t.Context(), 4); err != nil || len(got.Outcomes) != 0 {
		t.Fatalf("ran before a local release: %+v %v", got, err)
	}
	now = now.Add(time.Minute)
	if got, err := run.ProcessDue(t.Context(), 4); err != nil || got.Outcomes[domain.NoBusiness] != 1 || got.Published != 0 {
		t.Fatalf("unclassified drives were not suppressed: %+v %v", got, err)
	}
	plan := read(packetPath, mediaOwner).Plan
	invoiceRequest[struct{}](t, router, http.MethodGet, packetPath+"&drive_id=803", mediaOwner, "", nil, http.StatusNotFound)
	entry := domain.Entry{DriveID: 801, Purpose: domain.Business, Receipts: []domain.Receipt{
		{DriveID: 801, Day: "2026-03-11", Reference: "Synthetic receipt", Currency: "USD", AmountMinor: 425},
	}}
	edit := packetInput(plan.Version)
	edit["entry"] = entry
	invoiceRequest[struct{}](t, router, http.MethodPatch, packetPath, mediaOwner, "", edit, http.StatusBadRequest)
	entry.Receipts[0].Day = "2026-03-09"
	edit["entry"] = entry
	invoiceRequest[struct{}](t, router, http.MethodPatch, packetPath, mediaOwner, "", edit, http.StatusNoContent)
	invoiceRequest[struct{}](t, router, http.MethodPatch, packetPath, mediaOwner, "", edit, http.StatusConflict)
	if got := read(packetPath, mediaOwner); got.Packet != nil {
		t.Fatal("editing bypassed the scheduled review")
	}
	var workers sync.WaitGroup
	pubs := make(chan int, 2)
	for range 2 {
		workers.Go(func() {
			got, err := packetsvc.NewReviews(packetdb.NewRepository(db.Pool), clock).ProcessDue(t.Context(), 4)
			if err != nil {
				t.Error(err)
			}
			pubs <- got.Published
		})
	}
	workers.Wait()
	if count := <-pubs + <-pubs; count != 1 {
		t.Fatalf("workers published %d reviews", count)
	}
	got := read(packetPath, mediaOwner)
	p := got.Packet
	if p == nil || got.Digest == "" || p.UnclassifiedDriveCount != 1 || len(p.UnclassifiedDriveIDs) != 1 ||
		p.UnclassifiedDriveIDs[0] != 802 || len(p.BusinessDrives) != 1 || p.BusinessDrives[0].ID != 801 ||
		p.ObservedBusinessDistanceM != 11250 || len(p.MatchedReceipts) != 1 || p.MatchedReceipts[0].AmountMinor != 425 ||
		p.Through.UTC().Format(time.RFC3339) != "2026-04-01T04:00:00Z" {
		t.Fatalf("the private month did not match explicit evidence: %+v", p)
	}
	for _, other := range []domain.Review{read(packetPath, mediaOther), read(packetEndpoint+"?vehicle_id=8", mediaOwner)} {
		if other.Plan != nil || other.Packet != nil || other.Entry != nil {
			t.Fatal("another vehicle or subject received private records")
		}
	}
	input := packetInput(got.Plan.Version)
	input["digest"] = got.Digest
	invoiceRequest[struct{}](t, router, http.MethodPost, packetPath, mediaOwner, "", input, http.StatusBadRequest)
	input["confirmed"] = true
	invoiceRequest[struct{}](t, router, http.MethodPost, packetPath, mediaOther, "", input, http.StatusConflict)
	exported := invoiceRequest[domain.Packet](t, router, http.MethodPost, packetPath, mediaOwner, "", input, http.StatusOK)
	if len(exported.BusinessDrives) != 1 || len(exported.MatchedReceipts) != 1 ||
		exported.UnclassifiedDriveCount != 1 || len(exported.UnclassifiedDriveIDs) != 0 {
		t.Fatalf("export included identifiers outside the business packet: %+v", exported)
	}
	if _, err := db.Pool.Exec(t.Context(), `UPDATE drives SET distance_m=12000 WHERE id=801`); err != nil {
		t.Fatal(err)
	}
	invoiceRequest[struct{}](t, router, http.MethodPost, packetPath, mediaOwner, "", input, http.StatusConflict)
	dismiss := packetInput(got.Plan.Version)
	dismiss["dismiss_through"] = p.Through
	invoiceRequest[struct{}](t, router, http.MethodPatch, packetPath, mediaOwner, "", dismiss, http.StatusNoContent)
	if read(packetPath, mediaOwner).Packet != nil {
		t.Fatal("this month's dismissed packet remained visible")
	}
	plan = read(packetPath, mediaOwner).Plan
	clear := fmt.Sprintf("%s&plan_id=%d&expected_revision=%d", packetPath, plan.ID, plan.Revision)
	invoiceRequest[struct{}](t, router, http.MethodDelete, clear, mediaOwner, "", nil, http.StatusNoContent)
	var drives, receipts int
	if err := db.Pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM drives),(SELECT count(*) FROM smart_trip_packet_receipts)`).
		Scan(&drives, &receipts); err != nil || drives != 5 || receipts != 0 {
		t.Fatalf("clear did not preserve source drives and erase derived receipts: %d drives, %d receipts, %v", drives, receipts, err)
	}
}

func TestTripPacketSuppressesFallbackDistanceAndDuplicateOvernightReceipts(t *testing.T) {
	now := packetEarly.Add(time.Minute)
	clock := func() time.Time { return now }
	db := seedTripPacket(t)
	router := packetRouter(db, clock, "X-Test-Subject")
	if _, err := db.Pool.Exec(t.Context(), `UPDATE drives SET distance_m=0 WHERE id=801`); err != nil {
		t.Fatal(err)
	}
	consent := map[string]any{"plan_id": 0, "expected_revision": 0, "time_zone": "America/New_York", "confirmed": true}
	invoiceRequest[struct{}](t, router, http.MethodPut, packetPath, mediaOwner, "", consent, http.StatusNoContent)
	review := invoiceRequest[domain.Review](t, router, http.MethodGet, packetPath, mediaOwner, "", nil, http.StatusOK)
	edit := packetInput(review.Plan.Version)
	edit["entry"] = domain.Entry{DriveID: 801, Purpose: domain.Business, Receipts: []domain.Receipt{
		{DriveID: 801, Day: "2026-03-09", Reference: "Synthetic overnight receipt", Currency: "USD", AmountMinor: 425},
		{DriveID: 801, Day: "2026-03-10", Reference: "synthetic overnight receipt", Currency: "CAD", AmountMinor: 580},
		{DriveID: 801, Day: "2026-03-09", Reference: "ΜΑΡΤΙΟΣ-014", Currency: "USD", AmountMinor: 710},
		{DriveID: 801, Day: "2026-03-10", Reference: "μαρτιος-014", Currency: "CAD", AmountMinor: 815},
	}}
	invoiceRequest[struct{}](t, router, http.MethodPatch, packetPath, mediaOwner, "", edit, http.StatusNoContent)
	result, err := packetsvc.NewReviews(packetdb.NewRepository(db.Pool), clock).ProcessDue(t.Context(), 4)
	if err != nil || result.Published != 0 || result.Outcomes[domain.Partial] != 1 {
		t.Fatalf("fallback distance or duplicate receipts qualified a packet: %+v %v", result, err)
	}
	review = invoiceRequest[domain.Review](t, router, http.MethodGet, packetPath, mediaOwner, "", nil, http.StatusOK)
	if review.Packet != nil || review.Digest != "" {
		t.Fatal("unverified business evidence was made available for export")
	}
}

func TestTripPacketRejectsPausedLease(t *testing.T) {
	now := packetEarly.Add(time.Minute)
	db := seedTripPacket(t)
	clock := func() time.Time { return now }
	router, repo := packetRouter(db, clock, "X-Test-Subject"), packetdb.NewRepository(db.Pool)
	consent := map[string]any{"plan_id": 0, "expected_revision": 0, "time_zone": "America/New_York", "confirmed": true}
	invoiceRequest[struct{}](t, router, http.MethodPut, packetPath, mediaOwner, "", consent, http.StatusNoContent)
	job, err := repo.Claim(t.Context(), now, now.Add(15*time.Minute))
	if err != nil || job == nil {
		t.Fatalf("claim: %+v %v", job, err)
	}
	pause := packetInput(job.Version)
	pause["paused"], pause["time_zone"] = true, "America/New_York"
	invoiceRequest[struct{}](t, router, http.MethodPut, packetPath, mediaOwner, "", pause, http.StatusNoContent)
	through := time.Date(2026, 4, 1, 4, 0, 0, 0, time.UTC)
	if _, _, err := repo.Sources(t.Context(), job.Scope, job.Version,
		port.Window{From: through.AddDate(0, -1, 0), Through: through}, now, &job.Lease); err != port.ErrChanged {
		t.Fatalf("paused worker could still read history: %v", err)
	}
	if published, err := repo.Finish(t.Context(), *job, now, now.AddDate(0, 1, 0), through, true); published || err != nil {
		t.Fatalf("paused worker could still publish: %t %v", published, err)
	}
}

func TestTripPacketBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	db := seedTripPacket(t)
	now := packetEarly
	clock := func() time.Time { return now }
	mounted := packetRouter(db, clock, "X-Test-Subject")
	var gate sync.Mutex
	router := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gate.Lock()
		defer gate.Unlock()
		mounted.ServeHTTP(w, r)
	})
	tick := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gate.Lock()
		defer gate.Unlock()
		var want, ready int
		switch r.URL.Query().Get("phase") {
		case "early":
			now = packetEarly
		case "due":
			now, want, ready = packetEarly.Add(time.Minute), 1, 1
		case "recheck":
			now, ready = packetEarly.Add(time.Minute), 1
		default:
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		got, err := packetsvc.NewReviews(packetdb.NewRepository(db.Pool), clock).ProcessDue(r.Context(), 4)
		if err != nil || got.Published != want || got.Outcomes[domain.Ready] != ready ||
			(ready == 0 && len(got.Outcomes) != 0) {
			t.Errorf("expected %d publication(s): %+v %v", want, got, err)
			http.Error(w, "unexpected worker result", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	runPrivateMediaBrowserWithWorker(t, router, "synthetic-packet", "smart-trip-packet.smoke.spec.ts",
		"SMART_TRIP_PACKET_REAL_BACKEND", "/__fixture/trip-packet", tick)
}
