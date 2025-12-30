# Testing Tools for Pimp My Epstein

Tools for agents and developers to test the application without spending real money or hitting rate limits.

## Quick Start for Agents

### 1. Enable Test Mode (Unlimited Generations)

Set `TEST_MODE_SECRET` in `.env`:
```bash
TEST_MODE_SECRET=your-secret-here
```

Then pass the `X-Test-Mode` header with API requests:
```bash
curl -X POST http://localhost:3000/api/generate \
  -H "X-Test-Mode: your-secret-here" \
  -F "userPhoto=@photo.jpg" \
  -F "epsteinPhoto=/epstein-photos/epstein_bill_silk.jpg"
```

This bypasses rate limits for unlimited generations.

### 2. Test Stripe Without Paying

Use the Stripe test CLI:
```bash
# List configured products
node tools/stripe-test.js products

# Create a test checkout URL (opens in browser)
node tools/stripe-test.js checkout watermark

# Simulate webhook (test purchase completion)
node tools/stripe-test.js webhook checkout.session.completed.watermark --userId=test123
```

---

## Test Mode Header

The `X-Test-Mode` header provides unlimited generations for automated testing.

### Setup
1. Add to `.env`:
   ```
   TEST_MODE_SECRET=agent-test-secret-12345
   ```

2. Use in requests:
   ```javascript
   fetch('/api/generate', {
     method: 'POST',
     headers: {
       'X-Test-Mode': 'agent-test-secret-12345'
     },
     body: formData
   });
   ```

### What Test Mode Does
- Bypasses rate limits (unlimited generations)
- **Keeps watermarks** (tests real user experience)
- Logs `[TEST]` prefix in server output
- Does NOT consume user quotas

---

## Stripe Testing CLI

### Commands

#### `simulate-webhook <type>` - Simulate Stripe Events
Sends a mock webhook to your local/deployed server to test payment handling.

```bash
# Successful subscription purchase
node tools/stripe-test.js webhook checkout.session.completed --userId=user123

# Successful watermark removal ($2.99)
node tools/stripe-test.js webhook checkout.session.completed.watermark --userId=user123

# Successful credit pack purchase
node tools/stripe-test.js webhook checkout.session.completed.credits --userId=user123

# Subscription canceled
node tools/stripe-test.js webhook customer.subscription.deleted --userId=user123

# Payment failed
node tools/stripe-test.js webhook invoice.payment_failed --userId=user123
```

#### `verify-session <id>` - Check Session Status
Verify a checkout session was created correctly:

```bash
node tools/stripe-test.js verify cs_test_a1b2c3d4
```

#### `list-products` - View Configured Products
Show all Stripe products/prices from your `.env`:

```bash
node tools/stripe-test.js products
```

#### `test-checkout <type>` - Create Test Checkout
Generate a real Stripe checkout URL for manual testing:

```bash
# Subscription checkout ($14.99/mo)
node tools/stripe-test.js checkout subscription

# Credit pack checkout ($3.00)
node tools/stripe-test.js checkout credits

# Watermark removal checkout ($2.99)
node tools/stripe-test.js checkout watermark
```

---

## Stripe Test Cards

Use these card numbers in Stripe's test mode. All other details can be any valid values.

### Successful Payments
| Card Number | Description |
|-------------|-------------|
| `4242 4242 4242 4242` | Visa - Always succeeds |
| `5555 5555 5555 4444` | Mastercard - Always succeeds |
| `3782 822463 10005` | American Express - Always succeeds |

### Declined Payments
| Card Number | Description |
|-------------|-------------|
| `4000 0000 0000 0002` | Generic decline |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 9987` | Lost card |
| `4000 0000 0000 9979` | Stolen card |
| `4000 0000 0000 0069` | Expired card |

### 3D Secure Testing
| Card Number | Description |
|-------------|-------------|
| `4000 0027 6000 3184` | Requires authentication |
| `4000 0000 0000 3220` | 3DS required, completes successfully |

### For All Test Cards
- **Expiry**: Any future date (e.g., `12/34`)
- **CVC**: Any 3 digits (e.g., `123`) or 4 for Amex
- **ZIP**: Any 5 digits (e.g., `12345`)

---

## Testing Workflows

### Agent: Test Full Purchase Flow

```bash
# 1. Create checkout session via API
curl -X POST http://localhost:3000/api/buy-watermark-removal \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json"

# 2. Note the sessionId from response

# 3. Simulate successful payment webhook
node tools/stripe-test.js webhook checkout.session.completed.watermark \
  --userId=<user-id-from-token>

# 4. Verify user now has credits
curl http://localhost:3000/api/me \
  -H "Authorization: Bearer <user-token>"
```

### Agent: Test Generation with Test Mode

```bash
# Generate unlimited images without consuming quota
curl -X POST http://localhost:3000/api/generate \
  -H "X-Test-Mode: your-test-secret" \
  -F "userPhoto=@face.jpg" \
  -F "epsteinPhoto=/epstein-photos/epstein_bill_silk.jpg" \
  -F "modelType=quick"
```

### Agent: Test Webhook Handler

```bash
# Test all webhook types to ensure handler doesn't crash
for type in checkout.session.completed checkout.session.completed.watermark \
  checkout.session.completed.credits customer.subscription.deleted invoice.paid; do
  echo "Testing: $type"
  node tools/stripe-test.js webhook $type --userId=test-user
done
```

---

## Environment Variables for Testing

```bash
# Required for Stripe testing
STRIPE_SECRET_KEY=sk_test_...          # Must be a test key!
STRIPE_PRICE_BASE=price_...            # Subscription price ID
STRIPE_PRICE_CREDIT=price_...          # Credit pack price ID
STRIPE_PRICE_WATERMARK=price_...       # Watermark removal price ID

# For webhook simulation (optional - uses default if not set)
STRIPE_WEBHOOK_SECRET=whsec_...

# For X-Test-Mode header
TEST_MODE_SECRET=your-secret-here

# App URL for checkout redirects
APP_URL=http://localhost:3000
```

---

## Programmatic Usage

The stripe-test.js module can be imported for use in test scripts:

```javascript
const {
  simulateWebhook,
  verifySession,
  listProducts,
  createTestCheckout,
  createMockWebhookEvent
} = require('./tools/stripe-test');

// Simulate a webhook
await simulateWebhook('checkout.session.completed.watermark', {
  userId: 'test-user-123',
  email: 'test@example.com'
});

// Create a checkout session
const { session } = await createTestCheckout('watermark');
console.log('Checkout URL:', session.url);
```

---

## Troubleshooting

### "STRIPE_SECRET_KEY not set"
Make sure `.env` file exists and has `STRIPE_SECRET_KEY=sk_test_...`

### "Using LIVE Stripe key!"
The CLI refuses to run with live keys for safety. Switch to test keys.

### Webhook returns 401
Make sure `STRIPE_WEBHOOK_SECRET` matches what's configured in your Stripe dashboard, or the server is accepting test webhooks.

### Session verification fails
The session ID must exist in Stripe. Use `test-checkout` to create a real session first.
