package escalation

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// VerifyWebhookSignature verifies the authenticity and freshness of an
// Escalation Engine webhook event.
//
// The signature header has the format: t=<unix-timestamp>,v1=<hex-hmac>
// The signed payload is: <timestamp>.<raw-body>
//
// Parameters:
//   - payload: The raw request body as a string.
//   - signature: The value of the x-escalation-signature header.
//   - secret: The webhook signing secret for your organization.
//   - tolerance: Maximum age of the signature. Signatures older than this
//     are rejected to prevent replay attacks. Use 0 for no tolerance check.
//
// Returns true if the signature is valid and fresh, false otherwise.
func VerifyWebhookSignature(payload, signature, secret string, tolerance time.Duration) bool {
	if payload == "" || signature == "" || secret == "" {
		return false
	}

	// Parse the signature header: t=<timestamp>,v1=<hmac>
	var timestampStr, expectedSig string
	for _, part := range strings.Split(signature, ",") {
		if strings.HasPrefix(part, "t=") {
			timestampStr = part[2:]
		} else if strings.HasPrefix(part, "v1=") {
			expectedSig = part[3:]
		}
	}

	if timestampStr == "" || expectedSig == "" {
		return false
	}

	timestampNum, err := strconv.ParseInt(timestampStr, 10, 64)
	if err != nil {
		return false
	}

	// Check timestamp tolerance to prevent replay attacks
	if tolerance > 0 {
		now := time.Now().Unix()
		age := math.Abs(float64(now - timestampNum))
		if age > tolerance.Seconds() {
			return false
		}
	}

	// Compute expected HMAC: HMAC-SHA256(secret, "<timestamp>.<payload>")
	signedPayload := fmt.Sprintf("%s.%s", timestampStr, payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signedPayload))
	computedHMAC := hex.EncodeToString(mac.Sum(nil))

	// Timing-safe comparison
	expectedBytes, err := hex.DecodeString(expectedSig)
	if err != nil {
		return false
	}
	computedBytes, err := hex.DecodeString(computedHMAC)
	if err != nil {
		return false
	}

	return hmac.Equal(computedBytes, expectedBytes)
}

// ConstructWebhookSignature creates a webhook signature for testing purposes.
// Do NOT use this in production.
//
// Parameters:
//   - payload: The raw request body string.
//   - secret: The webhook signing secret.
//   - timestamp: Unix timestamp to use. If 0, uses the current time.
//
// Returns the signature string in the format t=<timestamp>,v1=<hmac>.
func ConstructWebhookSignature(payload, secret string, timestamp int64) string {
	if timestamp == 0 {
		timestamp = time.Now().Unix()
	}

	signedPayload := fmt.Sprintf("%d.%s", timestamp, payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signedPayload))
	hmacHex := hex.EncodeToString(mac.Sum(nil))

	return fmt.Sprintf("t=%d,v1=%s", timestamp, hmacHex)
}
