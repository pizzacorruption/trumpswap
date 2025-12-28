/**
 * Stripe Payment Service
 * Handles subscriptions for Pimp My Epstein Pro ($20/mo)
 */

const Stripe = require('stripe');

// Initialize Stripe with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// In-memory user store (replace with database in production)
// Structure: { odtep: { odtepId, email, tier, stripe_customer_id, stripe_subscription_id } }
const users = new Map();

/**
 * Get or create a user profile
 */
function getUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      userId,
      email: null,
      tier: 'free',
      stripe_customer_id: null,
      stripe_subscription_id: null
    });
  }
  return users.get(userId);
}

/**
 * Create a Stripe Checkout session for $20/mo Pro subscription
 * @param {string} userId - Internal user ID
 * @param {string} email - User's email address
 * @returns {Promise<{url: string, sessionId: string}>}
 */
async function createCheckoutSession(userId, email) {
  if (!process.env.STRIPE_PRICE_ID) {
    throw new Error('STRIPE_PRICE_ID not configured');
  }

  // Get or create user
  const user = getUser(userId);
  user.email = email;

  // Create or retrieve Stripe customer
  let customerId = user.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: {
        userId
      }
    });
    customerId = customer.id;
    user.stripe_customer_id = customerId;
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: `${process.env.APP_URL || 'http://localhost:3000'}/upgrade.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/upgrade.html?canceled=true`,
    metadata: {
      userId
    },
    subscription_data: {
      metadata: {
        userId
      }
    }
  });

  return {
    url: session.url,
    sessionId: session.id
  };
}

/**
 * Handle Stripe webhook events
 * @param {object} event - Stripe webhook event
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function handleWebhook(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const customerId = session.customer;
      const subscriptionId = session.subscription;

      if (userId) {
        const user = getUser(userId);
        user.tier = 'paid';
        user.stripe_customer_id = customerId;
        user.stripe_subscription_id = subscriptionId;

        console.log(`Upgraded user ${userId} to paid tier`);
      }

      return { success: true, message: 'Subscription activated' };
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;

      if (userId) {
        const user = getUser(userId);

        // Check subscription status
        if (subscription.status === 'active') {
          user.tier = 'paid';
        } else if (['canceled', 'unpaid', 'past_due'].includes(subscription.status)) {
          user.tier = 'free';
        }

        console.log(`Updated user ${userId} subscription status: ${subscription.status}`);
      }

      return { success: true, message: 'Subscription updated' };
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;

      if (userId) {
        const user = getUser(userId);
        user.tier = 'free';
        user.stripe_subscription_id = null;

        console.log(`Canceled subscription for user ${userId}`);
      }

      return { success: true, message: 'Subscription canceled' };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = invoice.customer;

      // Find user by customer ID
      for (const [userId, user] of users.entries()) {
        if (user.stripe_customer_id === customerId) {
          console.log(`Payment failed for user ${userId}`);
          // Could send email notification here
          break;
        }
      }

      return { success: true, message: 'Payment failure recorded' };
    }

    default:
      return { success: true, message: `Unhandled event type: ${event.type}` };
  }
}

/**
 * Cancel a user's subscription
 * @param {string} customerId - Stripe customer ID
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function cancelSubscription(customerId) {
  if (!customerId) {
    throw new Error('Customer ID required');
  }

  // List active subscriptions for customer
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 1
  });

  if (subscriptions.data.length === 0) {
    return { success: false, message: 'No active subscription found' };
  }

  // Cancel the subscription at period end (allows access until billing period ends)
  const subscription = await stripe.subscriptions.update(
    subscriptions.data[0].id,
    { cancel_at_period_end: true }
  );

  return {
    success: true,
    message: 'Subscription will cancel at end of billing period',
    cancelAt: new Date(subscription.current_period_end * 1000).toISOString()
  };
}

/**
 * Get subscription status for a user
 * @param {string} userId - Internal user ID
 * @returns {Promise<object>}
 */
async function getSubscriptionStatus(userId) {
  const user = getUser(userId);

  if (!user.stripe_subscription_id) {
    return {
      tier: user.tier,
      subscriptionStatus: null,
      subscriptionId: null
    };
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);

    return {
      tier: user.tier,
      subscriptionStatus: subscription.status,
      subscriptionId: subscription.id,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: subscription.cancel_at_period_end
    };
  } catch (err) {
    // Subscription might have been deleted
    return {
      tier: user.tier,
      subscriptionStatus: 'unknown',
      subscriptionId: null,
      error: err.message
    };
  }
}

/**
 * Construct and verify Stripe webhook event
 * @param {Buffer} rawBody - Raw request body
 * @param {string} signature - Stripe signature header
 * @returns {object} Verified Stripe event
 */
function constructWebhookEvent(rawBody, signature) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  }

  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

module.exports = {
  createCheckoutSession,
  handleWebhook,
  cancelSubscription,
  getSubscriptionStatus,
  constructWebhookEvent,
  getUser
};
