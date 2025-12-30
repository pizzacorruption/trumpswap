#!/usr/bin/env node
/**
 * Stripe Testing CLI for Pimp My Epstein
 *
 * Tools for agents and developers to test Stripe functionality without real payments.
 *
 * Usage:
 *   node tools/stripe-test.js <command> [options]
 *
 * Commands:
 *   simulate-webhook <type>    Simulate a Stripe webhook event
 *   verify-session <id>        Verify a checkout session status
 *   list-products              List configured Stripe products/prices
 *   test-checkout <type>       Create a test checkout session (outputs URL)
 */

require('dotenv').config();
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Colors for terminal output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(color, ...args) {
  console.log(colors[color], ...args, colors.reset);
}

// ============================================================================
// WEBHOOK SIMULATION
// ============================================================================

/**
 * Generate a mock webhook event payload
 */
function createMockWebhookEvent(type, data = {}) {
  const eventId = `evt_test_${Date.now()}`;
  const timestamp = Math.floor(Date.now() / 1000);

  const eventTemplates = {
    'checkout.session.completed': {
      id: eventId,
      object: 'event',
      type: 'checkout.session.completed',
      created: timestamp,
      data: {
        object: {
          id: data.sessionId || `cs_test_${Date.now()}`,
          object: 'checkout.session',
          customer: data.customerId || `cus_test_${Date.now()}`,
          customer_email: data.email || 'test@example.com',
          mode: data.mode || 'payment',
          payment_status: 'paid',
          status: 'complete',
          subscription: data.mode === 'subscription' ? `sub_test_${Date.now()}` : null,
          metadata: {
            userId: data.userId || 'test-user-123',
            type: data.checkoutType || 'subscription',
            ...(data.metadata || {})
          },
          amount_total: data.amount || 1499,
          currency: 'usd'
        }
      }
    },

    'checkout.session.completed.watermark': {
      id: eventId,
      object: 'event',
      type: 'checkout.session.completed',
      created: timestamp,
      data: {
        object: {
          id: data.sessionId || `cs_test_${Date.now()}`,
          object: 'checkout.session',
          customer: data.customerId || `cus_test_${Date.now()}`,
          customer_email: data.email || 'test@example.com',
          mode: 'payment',
          payment_status: 'paid',
          status: 'complete',
          metadata: {
            userId: data.userId || 'test-user-123',
            type: 'watermark_removal'
          },
          amount_total: 299,
          currency: 'usd'
        }
      }
    },

    'checkout.session.completed.credits': {
      id: eventId,
      object: 'event',
      type: 'checkout.session.completed',
      created: timestamp,
      data: {
        object: {
          id: data.sessionId || `cs_test_${Date.now()}`,
          object: 'checkout.session',
          customer: data.customerId || `cus_test_${Date.now()}`,
          customer_email: data.email || 'test@example.com',
          mode: 'payment',
          payment_status: 'paid',
          status: 'complete',
          metadata: {
            userId: data.userId || 'test-user-123',
            type: 'credit',
            quantity: String(data.quantity || 3)
          },
          amount_total: 300,
          currency: 'usd'
        }
      }
    },

    'customer.subscription.created': {
      id: eventId,
      object: 'event',
      type: 'customer.subscription.created',
      created: timestamp,
      data: {
        object: {
          id: data.subscriptionId || `sub_test_${Date.now()}`,
          object: 'subscription',
          customer: data.customerId || `cus_test_${Date.now()}`,
          status: 'active',
          current_period_start: timestamp,
          current_period_end: timestamp + (30 * 24 * 60 * 60),
          metadata: {
            userId: data.userId || 'test-user-123'
          }
        }
      }
    },

    'customer.subscription.deleted': {
      id: eventId,
      object: 'event',
      type: 'customer.subscription.deleted',
      created: timestamp,
      data: {
        object: {
          id: data.subscriptionId || `sub_test_${Date.now()}`,
          object: 'subscription',
          customer: data.customerId || `cus_test_${Date.now()}`,
          status: 'canceled',
          metadata: {
            userId: data.userId || 'test-user-123'
          }
        }
      }
    },

    'invoice.paid': {
      id: eventId,
      object: 'event',
      type: 'invoice.paid',
      created: timestamp,
      data: {
        object: {
          id: data.invoiceId || `in_test_${Date.now()}`,
          object: 'invoice',
          customer: data.customerId || `cus_test_${Date.now()}`,
          subscription: data.subscriptionId || `sub_test_${Date.now()}`,
          billing_reason: data.billingReason || 'subscription_cycle',
          amount_paid: data.amount || 1499,
          status: 'paid'
        }
      }
    },

    'invoice.payment_failed': {
      id: eventId,
      object: 'event',
      type: 'invoice.payment_failed',
      created: timestamp,
      data: {
        object: {
          id: data.invoiceId || `in_test_${Date.now()}`,
          object: 'invoice',
          customer: data.customerId || `cus_test_${Date.now()}`,
          subscription: data.subscriptionId || `sub_test_${Date.now()}`,
          amount_due: data.amount || 1499,
          status: 'open'
        }
      }
    }
  };

  return eventTemplates[type] || null;
}

/**
 * Generate a test webhook signature
 */
function generateTestSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

  // Use Stripe's built-in test header generator
  return stripe.webhooks.generateTestHeaderString({
    payload: payloadString,
    secret: secret || 'whsec_test_secret',
    timestamp
  });
}

/**
 * Send a simulated webhook to the local server
 */
async function simulateWebhook(eventType, options = {}) {
  const baseUrl = options.baseUrl || process.env.APP_URL || 'http://localhost:3000';
  const webhookSecret = options.secret || process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';

  log('cyan', `\n📨 Simulating webhook: ${eventType}`);

  const event = createMockWebhookEvent(eventType, options);
  if (!event) {
    log('red', `❌ Unknown event type: ${eventType}`);
    log('yellow', '\nAvailable event types:');
    console.log('  - checkout.session.completed');
    console.log('  - checkout.session.completed.watermark');
    console.log('  - checkout.session.completed.credits');
    console.log('  - customer.subscription.created');
    console.log('  - customer.subscription.deleted');
    console.log('  - invoice.paid');
    console.log('  - invoice.payment_failed');
    return { success: false, error: 'Unknown event type' };
  }

  const payloadString = JSON.stringify(event);
  const signature = generateTestSignature(payloadString, webhookSecret);

  log('blue', `  Event ID: ${event.id}`);
  log('blue', `  Target: ${baseUrl}/api/webhook/stripe`);

  try {
    const response = await fetch(`${baseUrl}/api/webhook/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature
      },
      body: payloadString
    });

    const result = await response.json().catch(() => ({ status: response.status }));

    if (response.ok) {
      log('green', `✅ Webhook delivered successfully`);
      console.log('  Response:', JSON.stringify(result, null, 2));
      return { success: true, result };
    } else {
      log('red', `❌ Webhook failed: ${response.status}`);
      console.log('  Response:', JSON.stringify(result, null, 2));
      return { success: false, status: response.status, result };
    }
  } catch (error) {
    log('red', `❌ Failed to send webhook: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// SESSION VERIFICATION
// ============================================================================

/**
 * Verify a checkout session status
 */
async function verifySession(sessionId) {
  log('cyan', `\n🔍 Verifying checkout session: ${sessionId}`);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['customer', 'subscription', 'line_items']
    });

    log('green', '✅ Session found');
    console.log('\n  Session Details:');
    console.log(`    ID: ${session.id}`);
    console.log(`    Status: ${session.status}`);
    console.log(`    Payment Status: ${session.payment_status}`);
    console.log(`    Mode: ${session.mode}`);
    console.log(`    Customer: ${session.customer?.email || session.customer_email || 'N/A'}`);
    console.log(`    Amount: $${(session.amount_total / 100).toFixed(2)}`);
    console.log(`    Metadata:`, session.metadata);

    if (session.subscription) {
      console.log(`    Subscription: ${session.subscription.id || session.subscription}`);
    }

    return { success: true, session };
  } catch (error) {
    log('red', `❌ Failed to verify session: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// PRODUCT LISTING
// ============================================================================

/**
 * List configured Stripe products and prices
 */
async function listProducts() {
  log('cyan', '\n📦 Configured Stripe Products\n');

  const priceIds = {
    'Base Subscription': process.env.STRIPE_PRICE_BASE,
    'Credit Pack': process.env.STRIPE_PRICE_CREDIT,
    'Watermark Removal': process.env.STRIPE_PRICE_WATERMARK
  };

  for (const [name, priceId] of Object.entries(priceIds)) {
    if (!priceId) {
      log('yellow', `  ${name}: NOT CONFIGURED`);
      continue;
    }

    try {
      const price = await stripe.prices.retrieve(priceId, {
        expand: ['product']
      });

      const amount = price.unit_amount / 100;
      const recurring = price.recurring ? `/${price.recurring.interval}` : ' (one-time)';

      log('green', `  ${name}:`);
      console.log(`    Price ID: ${priceId}`);
      console.log(`    Amount: $${amount.toFixed(2)}${recurring}`);
      console.log(`    Product: ${price.product?.name || 'N/A'}`);
      console.log(`    Active: ${price.active}`);
      console.log('');
    } catch (error) {
      log('red', `  ${name}: ERROR - ${error.message}`);
    }
  }

  return { success: true };
}

// ============================================================================
// TEST CHECKOUT
// ============================================================================

/**
 * Create a test checkout session
 */
async function createTestCheckout(type = 'subscription') {
  log('cyan', `\n🛒 Creating test checkout session (${type})`);

  const testUserId = `test_user_${Date.now()}`;
  const testEmail = 'test@example.com';

  try {
    let session;

    switch (type) {
      case 'subscription':
      case 'base': {
        const priceId = process.env.STRIPE_PRICE_BASE;
        if (!priceId) throw new Error('STRIPE_PRICE_BASE not configured');

        session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 1 }],
          mode: 'subscription',
          success_url: `${process.env.APP_URL || 'http://localhost:3000'}/upgrade.html?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/upgrade.html?canceled=true`,
          customer_email: testEmail,
          metadata: { userId: testUserId, type: 'subscription' }
        });
        break;
      }

      case 'credits': {
        const priceId = process.env.STRIPE_PRICE_CREDIT;
        if (!priceId) throw new Error('STRIPE_PRICE_CREDIT not configured');

        session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 3 }],
          mode: 'payment',
          success_url: `${process.env.APP_URL || 'http://localhost:3000'}/upgrade.html?credits_purchased=3&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/upgrade.html?canceled=true`,
          customer_email: testEmail,
          metadata: { userId: testUserId, type: 'credit', quantity: '3' }
        });
        break;
      }

      case 'watermark': {
        const priceId = (process.env.STRIPE_PRICE_WATERMARK || '').trim();
        if (!priceId) throw new Error('STRIPE_PRICE_WATERMARK not configured');

        session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 1 }],
          mode: 'payment',
          success_url: `${process.env.APP_URL || 'http://localhost:3000'}/?watermark_removed=true&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/?canceled=true`,
          customer_email: testEmail,
          metadata: { userId: testUserId, type: 'watermark_removal' }
        });
        break;
      }

      default:
        throw new Error(`Unknown checkout type: ${type}. Use: subscription, credits, or watermark`);
    }

    log('green', '✅ Checkout session created');
    console.log(`\n  Session ID: ${session.id}`);
    console.log(`  Checkout URL: ${session.url}`);
    console.log(`\n  ${colors.yellow}Use test card: 4242 4242 4242 4242${colors.reset}`);
    console.log(`  Expiry: Any future date (e.g., 12/34)`);
    console.log(`  CVC: Any 3 digits (e.g., 123)`);

    return { success: true, session };
  } catch (error) {
    log('red', `❌ Failed to create checkout: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!process.env.STRIPE_SECRET_KEY) {
    log('red', '❌ STRIPE_SECRET_KEY not set in environment');
    process.exit(1);
  }

  // Check if we're in test mode
  if (!process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    log('red', '⚠️  WARNING: Using LIVE Stripe key! This tool is meant for test mode.');
    log('yellow', '   Set STRIPE_SECRET_KEY to a test key (sk_test_...) for safe testing.');
    process.exit(1);
  }

  switch (command) {
    case 'simulate-webhook':
    case 'webhook': {
      const eventType = args[1];
      if (!eventType) {
        log('red', 'Usage: node stripe-test.js simulate-webhook <event-type> [--userId=xxx]');
        log('yellow', '\nEvent types:');
        console.log('  checkout.session.completed');
        console.log('  checkout.session.completed.watermark');
        console.log('  checkout.session.completed.credits');
        console.log('  customer.subscription.created');
        console.log('  customer.subscription.deleted');
        console.log('  invoice.paid');
        console.log('  invoice.payment_failed');
        process.exit(1);
      }

      // Parse options from args
      const options = {};
      for (const arg of args.slice(2)) {
        if (arg.startsWith('--')) {
          const [key, value] = arg.slice(2).split('=');
          options[key] = value;
        }
      }

      await simulateWebhook(eventType, options);
      break;
    }

    case 'verify-session':
    case 'verify': {
      const sessionId = args[1];
      if (!sessionId) {
        log('red', 'Usage: node stripe-test.js verify-session <session-id>');
        process.exit(1);
      }
      await verifySession(sessionId);
      break;
    }

    case 'list-products':
    case 'products': {
      await listProducts();
      break;
    }

    case 'test-checkout':
    case 'checkout': {
      const type = args[1] || 'subscription';
      await createTestCheckout(type);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
    default: {
      console.log(`
${colors.bold}Stripe Testing CLI for Pimp My Epstein${colors.reset}

${colors.cyan}Usage:${colors.reset}
  node tools/stripe-test.js <command> [options]

${colors.cyan}Commands:${colors.reset}
  ${colors.green}simulate-webhook <type>${colors.reset}  Simulate a Stripe webhook event
    Types: checkout.session.completed, checkout.session.completed.watermark,
           checkout.session.completed.credits, customer.subscription.created,
           customer.subscription.deleted, invoice.paid, invoice.payment_failed
    Options: --userId=xxx --email=xxx --customerId=xxx

  ${colors.green}verify-session <id>${colors.reset}      Verify a checkout session status

  ${colors.green}list-products${colors.reset}            List configured Stripe products/prices

  ${colors.green}test-checkout <type>${colors.reset}     Create a test checkout session
    Types: subscription, credits, watermark

${colors.cyan}Test Cards:${colors.reset}
  ${colors.green}4242 4242 4242 4242${colors.reset}  - Visa (always succeeds)
  ${colors.green}4000 0000 0000 0002${colors.reset}  - Card declined
  ${colors.green}4000 0000 0000 9995${colors.reset}  - Insufficient funds
  ${colors.green}4000 0027 6000 3184${colors.reset}  - Requires 3D Secure

${colors.cyan}Examples:${colors.reset}
  # Simulate a successful watermark removal purchase
  node tools/stripe-test.js webhook checkout.session.completed.watermark --userId=user123

  # Create a test checkout URL
  node tools/stripe-test.js checkout watermark

  # Verify a session
  node tools/stripe-test.js verify cs_test_xxx
`);
      break;
    }
  }
}

// Export for programmatic use
module.exports = {
  simulateWebhook,
  verifySession,
  listProducts,
  createTestCheckout,
  createMockWebhookEvent,
  generateTestSignature
};

// Run CLI if executed directly
if (require.main === module) {
  main().catch(err => {
    log('red', `Error: ${err.message}`);
    process.exit(1);
  });
}
