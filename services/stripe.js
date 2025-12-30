/**
 * Stripe Payment Service
 * Handles subscriptions and credit purchases for Pimp My Epstein
 *
 * Pricing Model:
 * - Base subscription: $14.99/month for 100 watermark-free images
 * - Credits: $3.00 per additional watermark-free image
 */

const Stripe = require('stripe');
const tiers = require('../config/tiers');

// Initialize Stripe with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// In-memory user store (replace with database in production)
// Structure: { userId: { userId, email, tier, stripe_customer_id, stripe_subscription_id, credit_balance } }
const users = new Map();

/**
 * Calculate the next monthly reset date (1 month from now)
 * @returns {Date}
 */
function getNextResetDate() {
  const now = new Date();
  const nextReset = new Date(now);
  nextReset.setMonth(nextReset.getMonth() + 1);
  return nextReset;
}

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
      stripe_subscription_id: null,
      credit_balance: 0,
      monthly_generation_count: 0,
      monthly_reset_at: null
    });
  }
  return users.get(userId);
}

/**
 * Create a Stripe Checkout session for Base subscription ($14.99/mo)
 * @param {string} userId - Internal user ID
 * @param {string} email - User's email address
 * @returns {Promise<{url: string, sessionId: string}>}
 */
async function createCheckoutSession(userId, email) {
  // Use new price ID or fall back to legacy
  const priceId = process.env.STRIPE_PRICE_BASE || process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error('STRIPE_PRICE_BASE not configured');
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
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: `${process.env.APP_URL || 'http://localhost:3000'}/upgrade.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/upgrade.html?canceled=true`,
    metadata: {
      userId,
      type: 'subscription'
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
 * Create a Stripe Checkout session for credit purchase ($3.00 per credit)
 * @param {string} userId - Internal user ID
 * @param {string} email - User's email address
 * @param {number} quantity - Number of credits to purchase (default: 1)
 * @returns {Promise<{url: string, sessionId: string}>}
 */
async function createCreditCheckoutSession(userId, email, quantity = 1) {
  const priceId = process.env.STRIPE_PRICE_CREDIT;
  if (!priceId) {
    throw new Error('STRIPE_PRICE_CREDIT not configured');
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

  // Create checkout session for one-time credit purchase
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: quantity,
      },
    ],
    mode: 'payment',  // One-time payment, not subscription
    success_url: `${process.env.APP_URL || 'http://localhost:3000'}/upgrade.html?credits_purchased=${quantity}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/upgrade.html?canceled=true`,
    metadata: {
      userId,
      type: 'credit',
      quantity: quantity.toString()
    }
  });

  return {
    url: session.url,
    sessionId: session.id
  };
}

/**
 * Create a Stripe Checkout session for watermark removal + 1 premium generation ($2.99)
 * Supports both authenticated and anonymous users
 *
 * @param {Object} options - Session options
 * @param {string} [options.userId] - Internal user ID (for authenticated users)
 * @param {string} [options.email] - User's email address (for authenticated users)
 * @param {string} [options.anonId] - Anonymous session ID (for anonymous users)
 * @param {string} [options.generationId] - Generation ID to unlock
 * @param {string} [options.viewToken] - View token for the generation
 * @param {string} [options.purchaseToken] - Unique token for anonymous purchases
 * @returns {Promise<{url: string, sessionId: string}>}
 */
async function createWatermarkRemovalSession(options) {
  const { userId, email, anonId, generationId, viewToken, purchaseToken } = options;

  const priceId = (process.env.STRIPE_PRICE_WATERMARK || '').trim();
  if (!priceId) {
    throw new Error('STRIPE_PRICE_WATERMARK not configured');
  }

  const sessionConfig = {
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'payment',  // One-time payment
    success_url: `${process.env.APP_URL || 'http://localhost:3000'}/?watermark_removed=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/?canceled=true`,
    metadata: {
      type: 'watermark_removal',
      generationId: generationId || '',
      viewToken: viewToken || ''
    }
  };

  // AUTHENTICATED USER PATH
  if (userId && email) {
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

    sessionConfig.customer = customerId;
    sessionConfig.metadata.userId = userId;
  } else {
    // ANONYMOUS USER PATH
    // Let Stripe collect email and create customer automatically
    sessionConfig.customer_creation = 'always';
    sessionConfig.metadata.anonId = anonId || '';
    sessionConfig.metadata.purchaseToken = purchaseToken || '';
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create(sessionConfig);

  return {
    url: session.url,
    sessionId: session.id
  };
}

/**
 * Create a Stripe Customer Portal session for subscription management
 * @param {string} customerId - Stripe customer ID
 * @returns {Promise<{url: string}>}
 */
async function createCustomerPortalSession(customerId) {
  if (!customerId) {
    throw new Error('Customer ID required');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.APP_URL || 'http://localhost:3000'}/upgrade.html`,
  });

  return {
    url: session.url
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
      const sessionMode = session.mode;
      const metadataType = session.metadata?.type;
      const checkoutType = metadataType || (sessionMode === 'payment' ? 'credit' : 'subscription');

      // Handle credit purchases
      if (checkoutType === 'credit') {
        const quantity = parseInt(session.metadata?.quantity || '1', 10);

        if (userId) {
          const user = getUser(userId);
          user.stripe_customer_id = customerId;
          user.credit_balance = (user.credit_balance || 0) + quantity;

          console.log(`Added ${quantity} credits to user ${userId}. New balance: ${user.credit_balance}`);
        }

        return {
          success: true,
          message: `${quantity} credit(s) added`,
          userId,
          creditsAdded: quantity,
          stripe_customer_id: customerId,
          checkoutType: 'credit'
        };
      }

      // Handle watermark removal purchase ($2.99 = 1 premium generation, watermark-free)
      if (checkoutType === 'watermark_removal') {
        if (userId) {
          const user = getUser(userId);
          user.stripe_customer_id = customerId;
          // Add 2 credits (enough for 1 premium generation which costs 2 credits)
          user.credit_balance = (user.credit_balance || 0) + 2;

          console.log(`Watermark removal purchased by user ${userId}. Added 2 credits for premium generation. Balance: ${user.credit_balance}`);
        }

        return {
          success: true,
          message: 'Watermark removal + premium generation unlocked',
          userId,
          creditsAdded: 2,
          stripe_customer_id: customerId,
          checkoutType: 'watermark_removal'
        };
      }

      // Handle subscription checkout
      const subscriptionId = session.subscription;
      const monthlyResetAt = getNextResetDate().toISOString();

      if (userId) {
        const user = getUser(userId);
        user.tier = 'base';  // Use 'base' for new subscriptions
        user.stripe_customer_id = customerId;
        user.stripe_subscription_id = subscriptionId;
        // Set monthly reset date
        user.monthly_generation_count = 0;
        user.monthly_reset_at = monthlyResetAt;

        console.log(`Upgraded user ${userId} to base tier`);
      }

      return {
        success: true,
        message: 'Subscription activated',
        userId,
        tier: 'base',
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        monthly_generation_count: 0,
        monthly_reset_at: monthlyResetAt,
        checkoutType: 'subscription'
      };
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;
      let tier = null;

      if (userId) {
        const user = getUser(userId);

        // Check subscription status
        if (subscription.status === 'active') {
          user.tier = 'base';
          tier = 'base';
        } else if (['canceled', 'unpaid', 'past_due'].includes(subscription.status)) {
          user.tier = 'free';
          tier = 'free';
        }

        console.log(`Updated user ${userId} subscription status: ${subscription.status}`);
      }

      return {
        success: true,
        message: 'Subscription updated',
        userId,
        tier,
        stripe_customer_id: subscription.customer,
        stripe_subscription_id: subscription.id
      };
    }

    // Handle invoice.paid for subscription renewal - reset monthly count
    case 'invoice.paid': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const subscriptionId = invoice.subscription;

      // Only process subscription renewals (not the initial payment)
      if (subscriptionId && invoice.billing_reason === 'subscription_cycle') {
        // Find user by customer ID
        for (const [userId, user] of users.entries()) {
          if (user.stripe_customer_id === customerId) {
            // Reset monthly count on renewal
            user.monthly_generation_count = 0;
            user.monthly_reset_at = getNextResetDate().toISOString();
            console.log(`Reset monthly count for user ${userId} on subscription renewal`);
            break;
          }
        }
      }

      return { success: true, message: 'Invoice paid processed' };
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

      return {
        success: true,
        message: 'Subscription canceled',
        userId,
        tier: 'free',
        stripe_customer_id: subscription.customer,
        stripe_subscription_id: null  // Clear subscription ID on cancel
      };
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

/**
 * Get the userId associated with a Stripe customer
 * Used for authorization checks to verify customer ownership
 * @param {string} customerId - Stripe customer ID
 * @returns {Promise<string|null>} The userId from customer metadata, or null if not found
 */
async function getUserIdForCustomer(customerId) {
  if (!customerId) {
    return null;
  }

  try {
    // First check our in-memory store
    for (const [userId, user] of users.entries()) {
      if (user.stripe_customer_id === customerId) {
        return userId;
      }
    }

    // If not in memory, retrieve from Stripe
    const customer = await stripe.customers.retrieve(customerId);

    if (customer.deleted) {
      return null;
    }

    // Return userId from metadata
    return customer.metadata?.userId || null;
  } catch (err) {
    console.error(`Error retrieving customer ${customerId}:`, err.message);
    return null;
  }
}

/**
 * Verify a completed checkout session and return the details
 * Used as fallback when webhooks don't work (e.g., local development)
 * @param {string} sessionId - Stripe checkout session ID
 * @returns {Promise<object>} Session details including payment status
 */
async function verifyCheckoutSession(sessionId) {
  if (!sessionId) {
    throw new Error('Session ID required');
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription', 'customer']
  });

  if (session.payment_status !== 'paid') {
    return {
      success: false,
      message: 'Payment not completed',
      status: session.payment_status
    };
  }

  const userId = session.metadata?.userId;
  const checkoutType = session.metadata?.type || (session.mode === 'payment' ? 'credit' : 'subscription');

  if (checkoutType === 'credit') {
    const quantity = parseInt(session.metadata?.quantity || '1', 10);
    return {
      success: true,
      type: 'credit',
      userId,
      customerId: session.customer?.id || session.customer,
      creditsAdded: quantity
    };
  }

  // Watermark removal purchase (2 credits for 1 premium generation)
  if (checkoutType === 'watermark_removal') {
    return {
      success: true,
      type: 'watermark_removal',
      userId,
      customerId: session.customer?.id || session.customer,
      creditsAdded: 2,  // 2 credits = 1 premium generation
      generationId: session.metadata?.generationId
    };
  }

  // Subscription checkout
  return {
    success: true,
    type: 'subscription',
    userId,
    customerId: session.customer?.id || session.customer,
    subscriptionId: session.subscription?.id || session.subscription,
    tier: 'base'
  };
}

module.exports = {
  createCheckoutSession,
  createCreditCheckoutSession,
  createWatermarkRemovalSession,
  createCustomerPortalSession,
  handleWebhook,
  cancelSubscription,
  getSubscriptionStatus,
  constructWebhookEvent,
  getUserIdForCustomer,
  getUser,
  verifyCheckoutSession
};
