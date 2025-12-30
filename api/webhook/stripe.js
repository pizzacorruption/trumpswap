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
const { createAdminClient } = require('../../lib/supabase');
const { getNextResetDate } = require('../../services/usage');

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Disable body parser for raw body access (required for signature verification)
const config = {
  api: {
    bodyParser: false,
  },
};

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
 * Uses admin client to bypass RLS for webhook-triggered updates
 * @param {string} userId - User ID from metadata
 * @param {object} updates - Fields to update
 */
async function updateUserProfile(userId, updates) {
  const supabaseAdmin = createAdminClient();

  if (!supabaseAdmin) {
    console.error('Supabase admin client not configured - cannot update user profile');
    return { error: new Error('Supabase admin client not configured') };
  }

  const { data, error } = await supabaseAdmin
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
 * Add credits to a user's balance using atomic SQL increment
 * SECURITY: Uses atomic increment to prevent race conditions
 * @param {string} userId - User ID
 * @param {number} creditsToAdd - Number of credits to add
 * @param {string} customerId - Stripe customer ID
 */
async function addCreditsToUser(userId, creditsToAdd, customerId) {
  const supabaseAdmin = createAdminClient();

  if (!supabaseAdmin) {
    console.error('Supabase admin client not configured - cannot update credit balance');
    return { error: new Error('Supabase admin client not configured') };
  }

  // Use atomic SQL increment to prevent race conditions
  const { data, error } = await supabaseAdmin.rpc('increment_credits', {
    user_id: userId,
    credits_to_add: creditsToAdd,
    customer_id: customerId || null
  });

  if (error) {
    // Fallback to non-atomic update if RPC not available
    console.warn('RPC not available, using fallback update:', error.message);

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('credit_balance')
      .eq('id', userId)
      .single();

    const currentCredits = profile?.credit_balance || 0;
    const newCredits = currentCredits + creditsToAdd;

    const updateData = {
      credit_balance: newCredits,
      updated_at: new Date().toISOString()
    };

    if (customerId) {
      updateData.stripe_customer_id = customerId;
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', userId);

    if (updateError) {
      console.error(`Failed to update credit balance for user ${userId}:`, updateError.message);
      return { error: updateError };
    }

    console.log(`Added ${creditsToAdd} credits to user ${userId}. New balance: ${newCredits}`);
    return { data: { credit_balance: newCredits } };
  }

  console.log(`Added ${creditsToAdd} credits to user ${userId} (atomic). New balance: ${data}`);
  return { data: { credit_balance: data } };
}

/**
 * Find user by Stripe customer ID
 * Uses admin client to bypass RLS
 * @param {string} customerId - Stripe customer ID
 */
async function findUserByCustomerId(customerId) {
  const supabaseAdmin = createAdminClient();

  if (!supabaseAdmin) {
    return { user: null, error: new Error('Supabase admin client not configured') };
  }

  const { data, error } = await supabaseAdmin
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
  let userId = session.metadata?.userId;
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  const sessionMode = session.mode;
  const metadataType = session.metadata?.type;
  const checkoutType = metadataType || (sessionMode === 'payment' ? 'credit' : 'subscription');

  if (checkoutType === 'credit') {
    if (!userId && customerId) {
      const { user } = await findUserByCustomerId(customerId);
      userId = user?.id;
    }

    if (!userId) {
      console.warn('checkout.session.completed (credit): Could not identify user');
      return { success: false, message: 'No userId for credit purchase' };
    }

    const quantity = parseInt(session.metadata?.quantity || '1', 10);
    const creditsToAdd = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;

    const { error } = await addCreditsToUser(userId, creditsToAdd, customerId);

    if (error) {
      return { success: false, message: error.message };
    }

    return {
      success: true,
      message: `${creditsToAdd} credit(s) added`,
      creditsAdded: creditsToAdd,
      userId
    };
  }

  // Handle watermark removal purchase ($2.99 = 2 credits for 1 premium generation)
  if (checkoutType === 'watermark_removal') {
    if (!userId && customerId) {
      const { user } = await findUserByCustomerId(customerId);
      userId = user?.id;
    }

    // For anonymous users, we may not have a userId - that's OK for watermark removal
    // The credits are associated via session metadata (generationId, purchaseToken)
    if (!userId) {
      console.log('checkout.session.completed (watermark_removal): Anonymous purchase');
      // For anonymous purchases, we don't add credits to a user account
      // The purchase is tracked via the session metadata
      return {
        success: true,
        message: 'Watermark removal purchased (anonymous)',
        generationId: session.metadata?.generationId,
        purchaseToken: session.metadata?.purchaseToken,
        anonId: session.metadata?.anonId
      };
    }

    // For authenticated users, add 2 credits (enough for 1 premium generation)
    const creditsToAdd = 2;
    const { error } = await addCreditsToUser(userId, creditsToAdd, customerId);

    if (error) {
      return { success: false, message: error.message };
    }

    console.log(`Watermark removal purchased by user ${userId}. Added ${creditsToAdd} credits for premium generation.`);

    return {
      success: true,
      message: 'Watermark removal + premium generation unlocked',
      creditsAdded: creditsToAdd,
      userId,
      generationId: session.metadata?.generationId
    };
  }

  if (!userId && customerId) {
    const { user } = await findUserByCustomerId(customerId);
    userId = user?.id;
  }

  if (!userId) {
    console.warn('checkout.session.completed: No userId in metadata');
    return { success: false, message: 'No userId in session metadata' };
  }

  const monthlyResetAt = getNextResetDate().toISOString();

  const { error } = await updateUserProfile(userId, {
    tier: 'base',
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    monthly_generation_count: 0,
    monthly_reset_at: monthlyResetAt,
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

  // Map Stripe subscription status to tier ('base' or 'free')
  // Active/trialing subscriptions get 'base' tier, everything else is 'free'
  let tier;
  switch (subscription.status) {
    case 'active':
    case 'trialing':
      tier = 'base';
      break;
    case 'past_due':
    case 'canceled':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
    default:
      tier = 'free';
      break;
  }

  const { error } = await updateUserProfile(userId, {
    tier,
    updated_at: new Date().toISOString()
  });

  if (error) {
    return { success: false, message: error.message };
  }

  console.log(`Subscription updated for user ${userId}: tier=${tier} (stripe status: ${subscription.status})`);
  return { success: true, message: 'Subscription updated', tier };
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
    tier: 'free',
    stripe_subscription_id: null,
    updated_at: new Date().toISOString()
  });

  if (error) {
    return { success: false, message: error.message };
  }

  console.log(`Subscription deleted for user ${userId}: tier=free`);
  return { success: true, message: 'Subscription canceled', tier: 'free' };
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

module.exports.config = config;
