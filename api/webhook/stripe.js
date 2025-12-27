/**
 * Stripe Webhook Handler
 * Vercel Serverless Function for processing Stripe webhook events
 *
 * Handles:
 * - checkout.session.completed (new subscription)
 * - customer.subscription.updated (subscription changes)
 * - customer.subscription.deleted (subscription cancelled)
 */

const Stripe = require('stripe');
const { createServerClient } = require('../../lib/supabase');

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Disable body parser for raw body access (required for signature verification)
const config = {
  api: {
    bodyParser: false,
  },
};

module.exports.config = config;

/**
 * Collect raw body from request stream
 * Required for Stripe webhook signature verification
 */
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Update user profile in Supabase
 * @param {string} userId - User ID from metadata
 * @param {object} updates - Fields to update
 */
async function updateUserProfile(userId, updates) {
  const supabase = createServerClient();

  if (!supabase) {
    console.error('Supabase not configured - cannot update user profile');
    return { error: new Error('Supabase not configured') };
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error(`Failed to update profile for user ${userId}:`, error.message);
    return { error };
  }

  console.log(`Updated profile for user ${userId}:`, updates);
  return { data };
}

/**
 * Find user by Stripe customer ID
 * @param {string} customerId - Stripe customer ID
 */
async function findUserByCustomerId(customerId) {
  const supabase = createServerClient();

  if (!supabase) {
    return { user: null, error: new Error('Supabase not configured') };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (error) {
    return { user: null, error };
  }

  return { user: data, error: null };
}

/**
 * Handle checkout.session.completed event
 * New subscription created successfully
 */
async function handleCheckoutCompleted(session) {
  const userId = session.metadata?.userId;
  const customerId = session.customer;
  const subscriptionId = session.subscription;

  if (!userId) {
    console.warn('checkout.session.completed: No userId in metadata');
    return { success: false, message: 'No userId in session metadata' };
  }

  const { error } = await updateUserProfile(userId, {
    subscription_status: 'active',
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    updated_at: new Date().toISOString()
  });

  if (error) {
    return { success: false, message: error.message };
  }

  console.log(`Subscription activated for user ${userId}`);
  return { success: true, message: 'Subscription activated' };
}

/**
 * Handle customer.subscription.updated event
 * Subscription status changed (active, past_due, canceled, etc.)
 */
async function handleSubscriptionUpdated(subscription) {
  let userId = subscription.metadata?.userId;

  // If no userId in metadata, try to find by customer ID
  if (!userId) {
    const { user } = await findUserByCustomerId(subscription.customer);
    userId = user?.id;
  }

  if (!userId) {
    console.warn('customer.subscription.updated: Could not identify user');
    return { success: false, message: 'Could not identify user' };
  }

  // Map Stripe subscription status to our subscription_status
  let subscriptionStatus;
  switch (subscription.status) {
    case 'active':
    case 'trialing':
      subscriptionStatus = 'active';
      break;
    case 'past_due':
      subscriptionStatus = 'past_due';
      break;
    case 'canceled':
    case 'unpaid':
      subscriptionStatus = 'canceled';
      break;
    case 'incomplete':
    case 'incomplete_expired':
      subscriptionStatus = 'incomplete';
      break;
    default:
      subscriptionStatus = subscription.status;
  }

  const { error } = await updateUserProfile(userId, {
    subscription_status: subscriptionStatus,
    updated_at: new Date().toISOString()
  });

  if (error) {
    return { success: false, message: error.message };
  }

  console.log(`Subscription updated for user ${userId}: ${subscriptionStatus}`);
  return { success: true, message: 'Subscription updated' };
}

/**
 * Handle customer.subscription.deleted event
 * Subscription was cancelled and has ended
 */
async function handleSubscriptionDeleted(subscription) {
  let userId = subscription.metadata?.userId;

  // If no userId in metadata, try to find by customer ID
  if (!userId) {
    const { user } = await findUserByCustomerId(subscription.customer);
    userId = user?.id;
  }

  if (!userId) {
    console.warn('customer.subscription.deleted: Could not identify user');
    return { success: false, message: 'Could not identify user' };
  }

  const { error } = await updateUserProfile(userId, {
    subscription_status: 'canceled',
    stripe_subscription_id: null,
    updated_at: new Date().toISOString()
  });

  if (error) {
    return { success: false, message: error.message };
  }

  console.log(`Subscription deleted for user ${userId}`);
  return { success: true, message: 'Subscription canceled' };
}

/**
 * Main webhook handler
 */
module.exports = async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate webhook secret is configured
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    // Get raw body for signature verification
    const rawBody = await getRawBody(req);
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      console.error('Missing stripe-signature header');
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Log the event type for debugging
  console.log(`Received Stripe webhook: ${event.type}`);

  let result;

  try {
    // Handle specific event types
    switch (event.type) {
      case 'checkout.session.completed':
        result = await handleCheckoutCompleted(event.data.object);
        break;

      case 'customer.subscription.updated':
        result = await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        result = await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_failed':
        // Log payment failure for monitoring
        console.warn(`Payment failed for customer: ${event.data.object.customer}`);
        result = { success: true, message: 'Payment failure logged' };
        break;

      default:
        // Acknowledge unhandled events without error
        console.log(`Unhandled event type: ${event.type}`);
        result = { success: true, message: `Unhandled event type: ${event.type}` };
    }

  } catch (err) {
    console.error(`Error processing ${event.type}:`, err.message);
    // Return 200 to prevent Stripe from retrying (we've logged the error)
    return res.status(200).json({
      received: true,
      error: err.message
    });
  }

  // Always return 200 to acknowledge receipt
  // Stripe will retry on non-2xx responses
  return res.status(200).json({
    received: true,
    type: event.type,
    ...result
  });
};
