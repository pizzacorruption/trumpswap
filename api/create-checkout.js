const stripeService = require('../services/stripe');

/**
 * POST /api/create-checkout
 * Creates a Stripe checkout session for $20/mo Pro subscription
 * Body: { userId: string, email: string }
 */
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, email } = req.body;

    if (!userId || !email) {
      return res.status(400).json({
        error: 'userId and email are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format'
      });
    }

    const { url, sessionId } = await stripeService.createCheckoutSession(userId, email);

    res.json({
      success: true,
      checkoutUrl: url,
      sessionId
    });
  } catch (error) {
    console.error('Checkout creation error:', error.message);
    res.status(500).json({
      error: 'Failed to create checkout session',
      details: error.message
    });
  }
};
