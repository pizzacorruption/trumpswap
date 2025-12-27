/**
 * Tier Configuration for Trump Swap
 * Defines usage limits for each subscription tier
 */

module.exports = {
  anonymous: {
    limit: 1,
    name: 'Anonymous',
    description: 'Try it once without signing up'
  },
  free: {
    limit: 3,
    name: 'Free',
    description: 'Sign up for 3 free generations'
  },
  paid: {
    limit: Infinity,
    name: 'Pro',
    description: 'Unlimited generations'
  }
};
