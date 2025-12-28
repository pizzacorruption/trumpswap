# Pimp My Epstein - Vercel Deployment Guide

## Prerequisites

- [ ] GitHub account with repo access
- [ ] [Vercel account](https://vercel.com) (free tier works)
- [ ] [Supabase account](https://supabase.com) (free tier works)
- [ ] [Stripe account](https://stripe.com) (test mode for dev)
- [ ] [Google AI Studio](https://aistudio.google.com) account for Gemini API key

---

## 1. Supabase Setup

### Create Project
- [ ] Go to [supabase.com/dashboard](https://supabase.com/dashboard)
- [ ] Click "New Project"
- [ ] Name it (e.g., `pimp-my-epstein`)
- [ ] Set a strong database password (save it)
- [ ] Select region closest to users
- [ ] Wait for project to provision (~2 min)

### Run Database Schema
- [ ] Go to **SQL Editor** in sidebar
- [ ] Click "New Query"
- [ ] Paste entire contents of `supabase/schema.sql`
- [ ] Click "Run" (should complete with no errors)

### Enable Google OAuth
- [ ] Go to **Authentication** > **Providers**
- [ ] Find **Google** and toggle ON
- [ ] Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
- [ ] Create OAuth 2.0 Client ID (Web application)
- [ ] Add authorized redirect URI: `https://<YOUR_PROJECT>.supabase.co/auth/v1/callback`
- [ ] Copy Client ID and Secret back to Supabase Google provider settings
- [ ] Save

### Create Storage Bucket
- [ ] Go to **Storage** in sidebar
- [ ] Click "New Bucket"
- [ ] Name: `generations`
- [ ] Toggle **Public bucket** ON
- [ ] Create bucket

### Get Credentials
- [ ] Go to **Settings** > **API**
- [ ] Copy **Project URL** (for `SUPABASE_URL`)
- [ ] Copy **anon public** key (for `SUPABASE_ANON_KEY`)

---

## 2. Stripe Setup

### Create Product
- [ ] Go to [dashboard.stripe.com/products](https://dashboard.stripe.com/products)
- [ ] Click "Add product"
- [ ] Name: `Pimp My Epstein Pro`
- [ ] Pricing: **Recurring**, $20/month
- [ ] Save product
- [ ] Copy the **Price ID** (starts with `price_`) for `STRIPE_PRICE_ID`

### Get API Keys
- [ ] Go to [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys)
- [ ] Copy **Secret key** (for `STRIPE_SECRET_KEY`)
- [ ] Use test keys (`sk_test_...`) for development

### Webhook (after Vercel deploy)
- [ ] Go to [dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks)
- [ ] Click "Add endpoint"
- [ ] URL: `https://your-app.vercel.app/api/stripe-webhook`
- [ ] Select events:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- [ ] Copy **Signing secret** (for `STRIPE_WEBHOOK_SECRET`)

---

## 3. Vercel Deployment

### Connect Repository
- [ ] Go to [vercel.com/new](https://vercel.com/new)
- [ ] Import your GitHub repository
- [ ] Framework Preset: **Other**
- [ ] Root Directory: `./` (leave default)

### Set Environment Variables
Add all variables in Vercel project settings:

| Variable | Value |
|----------|-------|
| `GEMINI_API_KEY` | Your Google AI Studio key |
| `SUPABASE_URL` | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | `eyJ...` (anon key) |
| `STRIPE_SECRET_KEY` | `sk_test_...` or `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `STRIPE_PRICE_ID` | `price_...` |
| `APP_URL` | `https://your-app.vercel.app` |
| `ADMIN_PASSWORD` | Your chosen admin password |

### Deploy
- [ ] Click "Deploy"
- [ ] Wait for build to complete
- [ ] Note your deployment URL

### Update Stripe Webhook
- [ ] Go back to Stripe webhooks
- [ ] Update endpoint URL with your actual Vercel domain
- [ ] Copy new signing secret if regenerated

---

## 4. Post-Deployment Testing

### Health Check
- [ ] Visit `https://your-app.vercel.app/api/health`
- [ ] Should return `{"status":"ok",...}`

### Image Generation
- [ ] Go to main app URL
- [ ] Upload a face photo
- [ ] Select an Epstein photo
- [ ] Generate (should work for free tier limit)

### Google Login
- [ ] Click "Sign in with Google"
- [ ] Complete OAuth flow
- [ ] Should redirect back logged in
- [ ] Check Supabase **Authentication** > **Users** for new entry

### Payment Flow
- [ ] Click upgrade/subscribe button
- [ ] Use Stripe test card: `4242 4242 4242 4242`
- [ ] Any future expiry, any CVC
- [ ] Complete checkout
- [ ] Verify user tier updated to `paid` in Supabase profiles table

---

## Troubleshooting

**Build fails**: Check Vercel build logs. Common issues:
- Missing env vars (add all required vars)
- Sharp binary issues (Vercel handles this automatically)

**OAuth redirect error**: Verify redirect URI in Google Cloud Console matches exactly:
`https://<project>.supabase.co/auth/v1/callback`

**Stripe webhook 400 errors**:
- Verify webhook secret matches
- Check Stripe webhook logs for payload details

**Generation fails**:
- Check Gemini API key is valid
- Check API quota in Google AI Studio
