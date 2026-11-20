// Package smartdeliverysvc manages verified, private browser delivery.
package smartdeliverysvc

import (
	"context"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/crypto"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	"github.com/ev-dev-labs/teslasync/internal/models"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	readinessport "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

var (
	ErrInvalidInput = errors.New("invalid personal delivery input")
	ErrUnavailable  = errors.New("personal delivery is not configured")
	ErrDelivery     = errors.New("personal delivery confirmation could not be sent")
)

type Sender interface {
	IsEnabled() bool
	PublicKey() string
	Send(context.Context, domain.Subscription, []byte, time.Duration) (domain.DeliveryStatus, error)
}

type ChargingCandidates interface {
	FindCandidate(context.Context, string, int64, int64) (*readinessport.Candidate, error)
}

type QuietHours interface {
	ListByUser(context.Context, string) ([]*models.QuietHoursWindow, error)
}

type Service struct {
	repository port.Repository
	encryptor  *crypto.Encryptor
	sender     Sender
	now        func() time.Time
	candidates ChargingCandidates
	quietHours QuietHours
	observe    func(string)
}

type Option func(*Service)

func WithClock(now func() time.Time) Option {
	if now == nil {
		panic("smartdeliverysvc.WithClock: clock must not be nil")
	}
	return func(service *Service) { service.now = now }
}

func WithChargingCandidates(candidates ChargingCandidates) Option {
	if candidates == nil {
		panic("smartdeliverysvc.WithChargingCandidates: candidates must not be nil")
	}
	return func(service *Service) { service.candidates = candidates }
}

func WithQuietHours(quietHours QuietHours) Option {
	if quietHours == nil {
		panic("smartdeliverysvc.WithQuietHours: quiet hours must not be nil")
	}
	return func(service *Service) { service.quietHours = quietHours }
}

func WithDeliveryObserver(observe func(string)) Option {
	if observe == nil {
		panic("smartdeliverysvc.WithDeliveryObserver: observer must not be nil")
	}
	return func(service *Service) { service.observe = observe }
}

func New(repository port.Repository, encryptor *crypto.Encryptor, sender Sender, options ...Option) *Service {
	if repository == nil || sender == nil {
		panic("smartdeliverysvc.New: repository and sender must not be nil")
	}
	service := &Service{
		repository: repository, encryptor: encryptor, sender: sender,
		now: func() time.Time { return time.Now().UTC() },
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) Available() bool {
	return s.encryptor != nil && s.sender.IsEnabled()
}

func (s *Service) PublicKey() string {
	if !s.Available() {
		return ""
	}
	return s.sender.PublicKey()
}

func (s *Service) ListDevices(ctx context.Context, subject string, limit, offset int) ([]domain.Device, error) {
	if !validSubject(subject) {
		return nil, ErrInvalidInput
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repository.ListDevices(ctx, subject, limit, offset)
}

func (s *Service) FindDevice(ctx context.Context, subject, endpoint string) (*domain.Device, error) {
	if !validSubject(subject) || !domain.ValidSubscriptionEndpoint(endpoint) {
		return nil, ErrInvalidInput
	}
	hash := sha256.Sum256([]byte(endpoint))
	return s.repository.FindDevice(ctx, subject, hash[:])
}

func (s *Service) Enroll(
	ctx context.Context, subject string, subscription domain.Subscription, texts domain.Texts,
) (*domain.Device, error) {
	if !validSubject(subject) || !validSubscription(&subscription) || !validTexts(texts) {
		return nil, ErrInvalidInput
	}
	if !s.Available() {
		return nil, ErrUnavailable
	}
	encoded, err := json.Marshal(subscription)
	if err != nil {
		return nil, fmt.Errorf("encode personal delivery subscription: %w", err)
	}
	ciphertext, err := s.encryptor.Encrypt(string(encoded))
	if err != nil {
		return nil, errors.New("encrypt personal delivery subscription")
	}
	token, tokenHash, err := newToken()
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	endpointHash := sha256.Sum256([]byte(subscription.Endpoint))
	device, err := s.repository.SavePending(ctx, subject, endpointHash[:], ciphertext, tokenHash[:],
		now.Add(10*time.Minute), texts, now)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(struct {
		Kind     string `json:"kind"`
		DeviceID int64  `json:"device_id"`
		Token    string `json:"token"`
	}{Kind: "verify", DeviceID: device.ID, Token: token})
	if err != nil {
		return nil, errors.New("encode personal delivery confirmation")
	}
	status, sendErr := s.sender.Send(ctx, subscription, payload, 10*time.Minute)
	if sendErr != nil || status != domain.DeliveryAccepted {
		return device, ErrDelivery
	}
	return device, nil
}

func (s *Service) Verify(ctx context.Context, subject string, id int64, token string) (*domain.Notification, error) {
	if !validSubject(subject) || id <= 0 || !validToken(token) {
		return nil, ErrInvalidInput
	}
	hash := sha256.Sum256([]byte(token))
	return s.repository.Verify(ctx, subject, id, hash[:], s.now().UTC())
}

func (s *Service) SetChargingEnabled(ctx context.Context, subject string, id int64, enabled bool) error {
	if !validSubject(subject) || id <= 0 {
		return ErrInvalidInput
	}
	if enabled && !s.Available() {
		return ErrUnavailable
	}
	return s.repository.SetChargingEnabled(ctx, subject, id, enabled, s.now().UTC())
}

func (s *Service) DeleteDevice(ctx context.Context, subject string, id int64) error {
	if !validSubject(subject) || id <= 0 {
		return ErrInvalidInput
	}
	return s.repository.DeleteDevice(ctx, subject, id)
}

func validSubject(subject string) bool {
	return strings.TrimSpace(subject) != "" && len(subject) <= 512
}

func validSubscription(subscription *domain.Subscription) bool {
	if subscription == nil || !domain.ValidSubscriptionEndpoint(subscription.Endpoint) {
		return false
	}
	subscription.Auth = strings.TrimRight(subscription.Auth, "=")
	subscription.P256DH = strings.TrimRight(subscription.P256DH, "=")
	auth, authErr := base64.RawURLEncoding.DecodeString(subscription.Auth)
	public, publicErr := base64.RawURLEncoding.DecodeString(subscription.P256DH)
	if authErr != nil || publicErr != nil || len(auth) != 16 || len(public) != 65 {
		return false
	}
	x, y := elliptic.Unmarshal(elliptic.P256(), public)
	return x != nil && y != nil
}

func validTexts(texts domain.Texts) bool {
	for _, text := range []string{
		texts.VerificationTitle, texts.VerificationBody, texts.ChargingTitle, texts.ChargingBody,
	} {
		if !utf8.ValidString(text) || strings.TrimSpace(text) == "" || utf8.RuneCountInString(text) > 160 {
			return false
		}
		for _, character := range text {
			if unicode.IsControl(character) {
				return false
			}
		}
	}
	return true
}

func newToken() (string, [32]byte, error) {
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", [32]byte{}, errors.New("generate personal delivery token")
	}
	token := base64.RawURLEncoding.EncodeToString(random[:])
	return token, sha256.Sum256([]byte(token)), nil
}

func validToken(token string) bool {
	if len(token) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil && len(decoded) == 32
}
