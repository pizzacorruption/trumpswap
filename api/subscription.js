const stripeService = require('../services/stripe');

/**
 * GET /api/subscription
 * Returns the current user's subscription status
 * Query: ?userId=xxx
 */
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        error: 'userId query parameter is required'
      });
    }

    const status = await stripeService.getSubscriptionStatus(userId);

    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('Subscription status error:', error.message);
    res.status(500).json({
      error: 'Failed to get subscription status',
      details: error.message
    });
  }
};
