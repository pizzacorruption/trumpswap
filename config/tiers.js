/**
 * Tier Configuration for Pimp My Epstein
 * Defines usage limits for each subscription tier
 *
 * Two-Tier Generation System:
 * - Quick: Fast Gemini model (gemini-2.0-flash-exp) - more quota, instant results
 * - Premium: High-quality Imagen 3 (imagen-3.0-generate-002) - fewer uses, best quality
 *
 * Pricing Model:
 * - Anonymous/Free users get 3 quick + 1 premium watermarked generation
 * - Base subscription: $14.99/month for 100 quick + 10 premium watermark-free
 * - Credits: $3.00 for 3 premium generations
 */

// Stripe price IDs (set these in environment variables)
const STRIPE_PRICE_BASE = process.env.STRIPE_PRICE_BASE || null;  // $14.99/mo subscription
const STRIPE_PRICE_CREDIT = process.env.STRIPE_PRICE_CREDIT || null;  // $3.00 credit pack

// Model configurations
const models = {
  quick: {
    name: 'Quick',
    modelId: 'gemini-2.0-flash-exp',  // Nano Banana - fast, good quality
    provider: 'gemini',
    description: 'Fast results in seconds',
    avgTime: '5-10 seconds'
  },
  premium: {
    name: 'Premium',
    modelId: 'gemini-3-pro-image-preview',  // Current best model
    provider: 'gemini',
    description: 'Highest quality, best face matching',
    avgTime: '15-30 seconds'
  }
};

module.exports = {
  models,

  anonymous: {
    limit: 4,  // 3 quick + 1 premium
    monthlyLimit: 4,
    quickLimit: 3,
    premiumLimit: 1,
    name: 'Anonymous',
    description: 'Try 3 quick + 1 premium generation',
    watermarkFree: false,
    canPurchaseCredits: false
  },
  free: {
    limit: 6,  // 5 quick + 1 premium
    monthlyLimit: 6,
    quickLimit: 5,
    premiumLimit: 1,
    name: 'Free',
    description: '5 quick + 1 premium generation',
    watermarkFree: false,
    canPurchaseCredits: true
  },
  base: {
    limit: Infinity,
    monthlyLimit: 50,  // 50 total generations per month (any model)
    quickLimit: 50,    // Can use all 50 as quick
    premiumLimit: 50,  // Or all 50 as premium (shared pool)
    name: 'Base',
    description: '50 watermark-free images per month',
    watermarkFree: true,
    canPurchaseCredits: true,
    priceId: STRIPE_PRICE_BASE,
    priceMonthly: 14.99
  },
  // Legacy tier - treat as base for backward compatibility
  paid: {
    limit: Infinity,
    monthlyLimit: 50,
    quickLimit: 50,
    premiumLimit: 50,
    name: 'Base',
    description: '50 watermark-free images per month',
    watermarkFree: true,
    canPurchaseCredits: true,
    priceId: STRIPE_PRICE_BASE,
    priceMonthly: 14.99
  },
  // Credit purchase info - 1 credit = quick, 2 credits = premium
  credit: {
    priceId: STRIPE_PRICE_CREDIT,
    pricePerPack: 3.00,
    creditsPerPack: 3,  // $3 = 3 credits ($1 each)
    quickCost: 1,       // 1 credit per quick generation
    premiumCost: 2,     // 2 credits per premium generation
    description: '3 credits ($1 each) - Quick: 1 credit, Premium: 2 credits'
  }
};
