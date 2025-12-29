/**
 * Mock Data for Testing
 *
 * Provides consistent mock data for unit and integration tests.
 */

const crypto = require('crypto');

// ============================================
// MOCK USERS
// ============================================

const mockUsers = {
  // Anonymous user (no profile)
  anonymous: {
    id: null,
    email: null,
    profile: null,
  },

  // Free tier user with no generations
  freeNew: {
    id: 'user-free-new-001',
    email: 'free-new@test.epswag.local',
    profile: {
      id: 'user-free-new-001',
      generation_count: 0,
      subscription_status: null,
      stripe_customer_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    },
  },

  // Free tier user with 1 generation
  freeWithUsage: {
    id: 'user-free-used-001',
    email: 'free-used@test.epswag.local',
    profile: {
      id: 'user-free-used-001',
      generation_count: 1,
      subscription_status: null,
      stripe_customer_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-15T12:00:00.000Z',
    },
  },

  // Free tier user at limit
  freeAtLimit: {
    id: 'user-free-limit-001',
    email: 'free-limit@test.epswag.local',
    profile: {
      id: 'user-free-limit-001',
      generation_count: 3,
      subscription_status: null,
      stripe_customer_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-20T18:00:00.000Z',
    },
  },

  // Free tier user over limit
  freeOverLimit: {
    id: 'user-free-over-001',
    email: 'free-over@test.epswag.local',
    profile: {
      id: 'user-free-over-001',
      generation_count: 10,
      subscription_status: null,
      stripe_customer_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-25T20:00:00.000Z',
    },
  },

  // Paid tier user (active subscription)
  paidActive: {
    id: 'user-paid-active-001',
    email: 'paid-active@test.epswag.local',
    profile: {
      id: 'user-paid-active-001',
      generation_count: 150,
      subscription_status: 'active',
      stripe_customer_id: 'cus_test_paid_active_001',
      stripe_subscription_id: 'sub_test_paid_active_001',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-02-01T10:00:00.000Z',
    },
  },

  // Paid tier user (cancelled subscription - still active until period end)
  paidCancelled: {
    id: 'user-paid-cancel-001',
    email: 'paid-cancel@test.epswag.local',
    profile: {
      id: 'user-paid-cancel-001',
      generation_count: 50,
      subscription_status: 'cancelled',
      stripe_customer_id: 'cus_test_paid_cancel_001',
      stripe_subscription_id: 'sub_test_paid_cancel_001',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-02-10T14:00:00.000Z',
    },
  },

  // User with expired subscription
  expiredSubscription: {
    id: 'user-expired-001',
    email: 'expired@test.epswag.local',
    profile: {
      id: 'user-expired-001',
      generation_count: 25,
      subscription_status: 'expired',
      stripe_customer_id: 'cus_test_expired_001',
      stripe_subscription_id: null,
      created_at: '2023-06-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    },
  },
};

// ============================================
// MOCK GENERATIONS
// ============================================

const mockGenerations = {
  // Completed generation
  completed: {
    id: 'gen-completed-001',
    userId: 'user-free-used-001',
    epsteinPhoto: '/epstein-photos/clinton-1993-1.jpg',
    viewToken: null,
    status: 'completed',
    resultUrl: '/output/epstein_1704067200000.png',
    errorCode: null,
    errorMessage: null,
    createdAt: '2024-01-01T12:00:00.000Z',
    completedAt: '2024-01-01T12:00:15.000Z',
  },

  // Pending generation
  pending: {
    id: 'gen-pending-001',
    userId: 'user-free-used-001',
    epsteinPhoto: '/epstein-photos/test.jpg',
    viewToken: null,
    status: 'pending',
    resultUrl: null,
    errorCode: null,
    errorMessage: null,
    createdAt: '2024-01-02T14:00:00.000Z',
    completedAt: null,
  },

  // Failed generation - safety block
  failedSafety: {
    id: 'gen-failed-safety-001',
    userId: 'user-free-limit-001',
    epsteinPhoto: '/epstein-photos/test.jpg',
    viewToken: null,
    status: 'failed',
    resultUrl: null,
    errorCode: 'SAFETY_BLOCK',
    errorMessage: 'Content blocked by safety filters',
    createdAt: '2024-01-03T16:00:00.000Z',
    completedAt: '2024-01-03T16:00:05.000Z',
  },

  // Failed generation - no face
  failedNoFace: {
    id: 'gen-failed-noface-001',
    userId: 'user-free-limit-001',
    epsteinPhoto: '/epstein-photos/test.jpg',
    viewToken: null,
    status: 'failed',
    resultUrl: null,
    errorCode: 'NO_FACE',
    errorMessage: 'No face detected in the photo',
    createdAt: '2024-01-04T18:00:00.000Z',
    completedAt: '2024-01-04T18:00:03.000Z',
  },

  // Failed generation - timeout
  failedTimeout: {
    id: 'gen-failed-timeout-001',
    userId: 'user-paid-active-001',
    epsteinPhoto: '/epstein-photos/test.jpg',
    viewToken: null,
    status: 'failed',
    resultUrl: null,
    errorCode: 'TIMEOUT',
    errorMessage: 'Request timed out',
    createdAt: '2024-01-05T10:00:00.000Z',
    completedAt: '2024-01-05T10:02:00.000Z',
  },

  // Anonymous generation (has viewToken)
  anonymous: {
    id: 'gen-anonymous-001',
    userId: null,
    epsteinPhoto: '/epstein-photos/test.jpg',
    viewToken: crypto.randomBytes(32).toString('hex'),
    status: 'completed',
    resultUrl: '/output/epstein_1704153600000.png',
    errorCode: null,
    errorMessage: null,
    createdAt: '2024-01-02T00:00:00.000Z',
    completedAt: '2024-01-02T00:00:20.000Z',
  },
};

// ============================================
// MOCK EPSTEIN PHOTOS
// ============================================

const mockEpsteinPhotos = [
  {
    name: 'clinton 1993 1',
    path: '/epstein-photos/clinton-1993-1.jpg',
    filename: 'clinton-1993-1.jpg',
  },
  {
    name: 'clinton 1993 2',
    path: '/epstein-photos/clinton-1993-2.jpg',
    filename: 'clinton-1993-2.jpg',
  },
  {
    name: 'test',
    path: '/epstein-photos/test.jpg',
    filename: 'test.jpg',
  },
  {
    name: 'sample',
    path: '/epstein-photos/sample.jpg',
    filename: 'sample.jpg',
  },
];

// ============================================
// MOCK API RESPONSES
// ============================================

const mockApiResponses = {
  health: {
    success: {
      status: 'ok',
      apiKeySet: true,
      stripeConfigured: true,
      supabaseConfigured: true,
      epsteinPhotosCount: 10,
      anonymousUsersTracked: 5,
    },
    noApiKey: {
      status: 'ok',
      apiKeySet: false,
      stripeConfigured: false,
      supabaseConfigured: false,
      epsteinPhotosCount: 0,
      anonymousUsersTracked: 0,
    },
  },

  photos: {
    success: {
      photos: mockEpsteinPhotos,
    },
    empty: {
      photos: [],
    },
  },

  generate: {
    success: {
      success: true,
      imageUrl: '/output/epstein_1704067200000.png',
      generationId: 'gen-new-001',
    },
    noFace: {
      error: 'No face detected in your photo. Please upload a clear photo of your face.',
      code: 'NO_FACE',
      details: 'Make sure your face is clearly visible, well-lit, and facing the camera.',
    },
    safetyBlock: {
      error: 'Content blocked by safety filters. Please try a different photo.',
      code: 'SAFETY_BLOCK',
      details: 'The AI detected potentially problematic content in the request.',
    },
    rateLimited: {
      error: 'Too many requests. Please wait a moment and try again.',
      code: 'RATE_LIMITED',
      details: 'The AI service is temporarily rate limited. Try again in 30-60 seconds.',
    },
    timeout: {
      error: 'Request timed out. The AI is busy - please try again.',
      code: 'TIMEOUT',
      details: 'Image generation took too long. This can happen during high traffic.',
    },
    limitReached: {
      error: "You've reached your generation limit",
      code: 'LIMIT_REACHED',
      tier: 'free',
      used: 3,
      limit: 3,
      upgradeUrl: '/pricing',
      message: 'Upgrade to Pro for unlimited generations!',
    },
  },

  me: {
    anonymous: {
      authenticated: false,
      user: null,
      profile: null,
      usage: {
        tier: 'anonymous',
        tierName: 'Anonymous',
        used: 0,
        limit: 1,
        remaining: 1,
        canGenerate: true,
      },
    },
    authenticated: {
      authenticated: true,
      user: {
        id: 'user-free-new-001',
        email: 'free-new@test.epswag.local',
        created_at: '2024-01-01T00:00:00.000Z',
      },
      profile: {
        generation_count: 0,
        subscription_status: null,
        stripe_customer_id: null,
      },
      usage: {
        tier: 'free',
        tierName: 'Free',
        used: 0,
        limit: 3,
        remaining: 3,
        canGenerate: true,
      },
    },
  },

  errors: {
    unauthorized: {
      error: 'Authentication required',
      message: 'Please log in to access this resource',
    },
    notFound: {
      error: 'Not found',
    },
    invalidFormat: {
      error: 'Invalid file format. Please use a JPG, PNG, or WebP file.',
      code: 'INVALID_FORMAT',
    },
    missingPhoto: {
      error: 'Your photo is required',
      code: 'INVALID_FORMAT',
      details: 'Please upload a photo of yourself.',
    },
    missingEpsteinPhoto: {
      error: 'Epstein photo selection is required',
      code: 'INVALID_FORMAT',
      details: 'Please select an Epstein photo from the gallery.',
    },
  },
};

// ============================================
// MOCK STRIPE DATA
// ============================================

const mockStripeData = {
  customer: {
    id: 'cus_test_001',
    email: 'test@test.epswag.local',
    metadata: {
      user_id: 'user-test-001',
    },
  },

  subscription: {
    active: {
      id: 'sub_test_001',
      status: 'active',
      customer: 'cus_test_001',
      current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days from now
      items: {
        data: [
          {
            price: {
              id: 'price_test_001',
              product: 'prod_test_001',
            },
          },
        ],
      },
    },
    cancelled: {
      id: 'sub_test_002',
      status: 'canceled',
      customer: 'cus_test_002',
      current_period_end: Math.floor(Date.now() / 1000) + 86400 * 15, // 15 days from now
    },
  },

  checkoutSession: {
    id: 'cs_test_001',
    url: 'https://checkout.stripe.com/test',
    customer: 'cus_test_001',
    subscription: 'sub_test_001',
  },

  webhookEvents: {
    checkoutCompleted: {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_001',
          customer: 'cus_test_001',
          subscription: 'sub_test_001',
          metadata: {
            user_id: 'user-test-001',
          },
        },
      },
    },
    subscriptionDeleted: {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_test_001',
          customer: 'cus_test_001',
        },
      },
    },
  },
};

// ============================================
// MOCK TIERS
// ============================================

const mockTiers = {
  anonymous: {
    name: 'Anonymous',
    limit: 1,
    description: 'Try it out! 1 free generation without signing up.',
  },
  free: {
    name: 'Free',
    limit: 3,
    description: 'Sign up free! 3 generations to start.',
  },
  paid: {
    name: 'Pro',
    limit: Infinity,
    description: '$20/month for unlimited generations.',
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a copy of mock data (to prevent mutation)
 */
function getMockUser(key) {
  const user = mockUsers[key];
  if (!user) return null;
  return JSON.parse(JSON.stringify(user));
}

function getMockGeneration(key) {
  const gen = mockGenerations[key];
  if (!gen) return null;
  return JSON.parse(JSON.stringify(gen));
}

function getMockApiResponse(category, key) {
  const response = mockApiResponses[category]?.[key];
  if (!response) return null;
  return JSON.parse(JSON.stringify(response));
}

/**
 * Create a unique mock generation
 */
function createMockGeneration(userId, overrides = {}) {
  const id = `gen-${crypto.randomBytes(8).toString('hex')}`;
  return {
    id,
    userId,
    epsteinPhoto: '/epstein-photos/test.jpg',
    viewToken: userId ? null : crypto.randomBytes(32).toString('hex'),
    status: 'pending',
    resultUrl: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Mock data
  mockUsers,
  mockGenerations,
  mockEpsteinPhotos,
  mockApiResponses,
  mockStripeData,
  mockTiers,

  // Helper functions
  getMockUser,
  getMockGeneration,
  getMockApiResponse,
  createMockGeneration,
};
