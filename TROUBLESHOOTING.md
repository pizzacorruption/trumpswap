# Troubleshooting Guide

Quick-reference for diagnosing and fixing common issues. Use the symptom index to jump to relevant sections.

---

## Symptom Index

| Symptom | Jump To |
|---------|---------|
| Tier shows FREE after payment | [#stripe-tier-not-updating](#stripe-tier-not-updating) |
| "Sign in required" after checkout | [#auth-lost-post-checkout](#auth-lost-post-checkout) |
| Console: "not valid JSON" errors | [#api-returning-html](#api-returning-html-instead-of-json) |
| Vercel deployment failed | [#vercel-deployment-errors](#vercel-deployment-errors) |
| Webhook not firing | [#stripe-webhook-issues](#stripe-webhook-issues) |
| Images not loading | [#image-loading-issues](#image-loading-issues) |
| Rate limit not working | [#rate-limit-bypass](#rate-limit-bypass) |

---

## Stripe: Tier Not Updating

**Symptom**: User completes Stripe checkout, sees "Welcome to Base!", but tier still shows FREE.

```
┌─────────────────────────────────────────────────────────────┐
│ DIAGNOSTIC FLOWCHART: Tier Not Updating After Payment       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Check Supabase profile directly:                        │
│     SELECT tier, stripe_customer_id, stripe_subscription_id │
│     FROM profiles WHERE email = 'user@example.com';         │
│                                                             │
│     ┌──────────────────┐                                    │
│     │ All fields NULL? │                                    │
│     └────────┬─────────┘                                    │
│              │                                              │
│      YES ────┼──── NO (has stripe_customer_id)              │
│              │              │                               │
│              ▼              ▼                               │
│     [Webhook failed]   [Webhook fired, update failed]       │
│              │              │                               │
│              ▼              ▼                               │
│     Check #2 below     Check Supabase RLS policies          │
│                                                             │
│  2. Check Vercel deployment status:                         │
│     - Is latest deploy in ERROR state?                      │
│     - Is api/webhook/stripe.js included?                    │
│     - Is api/verify-session.js included?                    │
│                                                             │
│  3. Check Vercel env vars:                                  │
│     REQUIRED:                                               │
│     - STRIPE_WEBHOOK_SECRET (whsec_...)                     │
│     - SUPABASE_SERVICE_ROLE_KEY                             │
│     - STRIPE_SECRET_KEY                                     │
│                                                             │
│  4. Check Stripe Dashboard → Webhooks:                      │
│     - Endpoint configured for production URL?               │
│     - Recent events showing 200 or errors?                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Common Causes (ordered by frequency)**:
1. `STRIPE_WEBHOOK_SECRET` not set in Vercel env vars
2. Vercel deployment failed (serverless function limit)
3. Webhook endpoint URL wrong in Stripe Dashboard
4. `SUPABASE_SERVICE_ROLE_KEY` missing (can't update profiles)

**Quick Fixes**:
```bash
# Verify webhook secret is set
vercel env ls | grep STRIPE_WEBHOOK_SECRET

# Test webhook endpoint manually
curl -X POST https://pimpmyepstein.lol/api/webhook/stripe \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
# Should return 400 "Missing stripe-signature" (not 404)

# Check Stripe CLI for webhook events
stripe listen --forward-to localhost:3000/api/webhook/stripe
```

---

## Auth Lost Post-Checkout

**Symptom**: After Stripe checkout, user lands on sign-in page instead of success page.

```
┌─────────────────────────────────────────────────────────────┐
│ DIAGNOSTIC: Auth Lost After Stripe Redirect                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Check URL after redirect:                                  │
│                                                             │
│  /upgrade.html?session_id=cs_xxx                            │
│       │                                                     │
│       ▼                                                     │
│  ┌────────────────────────┐                                 │
│  │ session_id present?    │                                 │
│  └───────────┬────────────┘                                 │
│              │                                              │
│      YES ────┼──── NO                                       │
│              │       │                                      │
│              ▼       ▼                                      │
│     [Should show    [Stripe redirect failed]                │
│      success msg]    Check APP_URL env var                  │
│              │                                              │
│              ▼                                              │
│  ┌────────────────────────┐                                 │
│  │ Check localStorage for │                                 │
│  │ Supabase session       │                                 │
│  └───────────┬────────────┘                                 │
│              │                                              │
│      Found ──┼── Not Found                                  │
│              │       │                                      │
│              ▼       ▼                                      │
│     [Token may be   [Session expired during                 │
│      expired]        Stripe checkout flow]                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Code Locations**:
- `public/upgrade.html:593-639` - Post-checkout auth check
- `public/index.html:2929-2962` - Auth initialization

**Common Causes**:
1. Supabase session expired (default 1 hour)
2. User on different browser/device after Stripe
3. localStorage cleared by browser settings
4. APP_URL mismatch (localhost vs production)

---

## API Returning HTML Instead of JSON

**Symptom**: Console shows `SyntaxError: Unexpected token '<'` or `"not valid JSON"`.

```
┌─────────────────────────────────────────────────────────────┐
│ DIAGNOSTIC: API Returns HTML                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Error message contains:                                    │
│  "The page c..." → 404 error (Vercel default page)          │
│  "<!DOCTYPE..."  → Server error page                        │
│                                                             │
│  Common offenders:                                          │
│  - /api/admin/status → Needs api/admin/status.js            │
│  - /api/verify-session → Needs api/verify-session.js        │
│  - /api/me → Check if server.js route or api/me.js          │
│                                                             │
│  Fix: Ensure endpoint exists in /api/ folder for Vercel     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Architecture Note**:
- Local dev uses `server.js` Express routes
- Vercel uses `/api/*.js` serverless functions
- **Both must implement the same endpoints**

---

## Vercel Deployment Errors

**Symptom**: Deployment shows ERROR state, site runs old code.

```
┌─────────────────────────────────────────────────────────────┐
│ DIAGNOSTIC: Vercel Deployment Failed                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Check error in Vercel Dashboard or:                        │
│  vercel deployments ls                                      │
│                                                             │
│  Common errors:                                             │
│                                                             │
│  "exceeded_serverless_functions_per_deployment"             │
│  └─► Hobby plan limit: 12 functions                         │
│      Fix: Consolidate /api/*.js files or upgrade plan       │
│                                                             │
│  "FUNCTION_INVOCATION_FAILED"                               │
│  └─► Check function logs: vercel logs <deployment-url>      │
│      Common: missing env var, import error                  │
│                                                             │
│  "BUILD_FAILED"                                             │
│  └─► Check build logs for npm/syntax errors                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Serverless Function Count**:
```bash
# Count current functions
ls -1 api/*.js api/**/*.js 2>/dev/null | wc -l

# Hobby limit: 12
# If over, consolidate into fewer files with route handling
```

---

## Stripe Webhook Issues

**Symptom**: Stripe shows successful payment but app doesn't react.

```
┌─────────────────────────────────────────────────────────────┐
│ DIAGNOSTIC: Webhook Not Working                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Stripe Dashboard → Developers → Webhooks                │
│     Check recent events - what status code?                 │
│                                                             │
│     200 ──► Webhook received, check server logic            │
│     400 ──► Signature verification failed                   │
│             └─► STRIPE_WEBHOOK_SECRET wrong/missing         │
│     404 ──► Endpoint not found                              │
│             └─► api/webhook/stripe.js missing               │
│             └─► Vercel deployment failed                    │
│     500 ──► Server error in handler                         │
│             └─► Check Vercel function logs                  │
│                                                             │
│  2. Required webhook events:                                │
│     - checkout.session.completed                            │
│     - customer.subscription.updated                         │
│     - customer.subscription.deleted                         │
│                                                             │
│  3. Webhook endpoint URL must be:                           │
│     https://pimpmyepstein.lol/api/webhook/stripe            │
│     (NOT /api/webhook/stripe/ with trailing slash)          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Local Testing**:
```bash
# Forward Stripe events to local
stripe listen --forward-to localhost:3000/api/webhook/stripe

# Trigger test event
stripe trigger checkout.session.completed
```

---

## Image Loading Issues

**Symptom**: Gallery images show broken icons or don't load.

**Common Causes**:
1. **viewToken appended to data URLs** - Fixed in commit 29c884b
   - Data URLs don't support query params
   - Check: `img.src` should not have `?viewToken=` if starts with `data:`

2. **CORS issues** - Check browser Network tab for blocked requests

3. **File path issues** - Ensure `/epstein-photos/` exists in `public/`

---

## Rate Limit Bypass

**Symptom**: Anonymous users getting more than 3 generations.

**Check Points**:
1. Cookie-based tracking: `anonId` cookie
2. IP-based tracking: `usage_counters` table
3. Both should be checked - use higher count

**Code Location**: `middleware/rateLimit.js`, `services/usage.js`

---

## Environment Variables Checklist

Required for production:

| Variable | Purpose | Get From |
|----------|---------|----------|
| `GEMINI_API_KEY` | AI generation | Google AI Studio |
| `SUPABASE_URL` | Database | Supabase Dashboard |
| `SUPABASE_ANON_KEY` | Client auth | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server updates | Supabase → Settings → API |
| `STRIPE_SECRET_KEY` | Payments | Stripe Dashboard |
| `STRIPE_PUBLISHABLE_KEY` | Frontend | Stripe Dashboard |
| `STRIPE_WEBHOOK_SECRET` | Webhook auth | Stripe → Webhooks → Signing secret |
| `STRIPE_PRICE_BASE` | $14.99 sub | Stripe → Products |
| `STRIPE_PRICE_CREDIT` | Credit pack | Stripe → Products |
| `STRIPE_PRICE_WATERMARK` | $2.99 unlock | Stripe → Products |
| `APP_URL` | Redirects | Your domain (NO trailing slash) |

---

## Quick Diagnostic Commands

```bash
# Check Vercel deployment status
vercel ls

# Check Vercel env vars
vercel env ls

# Check Supabase profile
# (use Supabase Dashboard SQL editor)
SELECT * FROM profiles WHERE email = 'user@email.com';

# Test API endpoint exists
curl -I https://pimpmyepstein.lol/api/webhook/stripe

# Count serverless functions
ls -1 api/*.js api/**/*.js 2>/dev/null | wc -l
```

---

## Issue Template

When documenting a new issue, use this format:

```markdown
## [Category]: [Short Description]

**Symptom**: What the user sees/experiences

**Diagnostic Flow**: (ASCII flowchart if helpful)

**Common Causes** (ordered by frequency):
1. Most common
2. Second most common
3. etc.

**Quick Fixes**: Code/commands to resolve

**Key Code Locations**: file:line references

**Related Issues**: Links to similar problems
```
