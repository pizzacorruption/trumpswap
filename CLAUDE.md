# Pimp My Epstein - AI Face Swap App

## IMPORTANT: ALWAYS PARALLELIZE WITH AGENTS

**When doing ANY multi-step task, ALWAYS use parallel agents:**
- Investigating multiple files? → Launch parallel Explore agents
- Testing multiple things? → Launch parallel test agents
- Researching + implementing? → Research agent + implementation agent in parallel
- Red teaming? → Launch 4-6 agents covering different attack vectors simultaneously
- Debugging? → Launch agents to check different potential causes at once

**Examples of parallelization:**
```
User: "Fix this bug and add tests"
→ Agent 1: Investigate bug
→ Agent 2: Research testing patterns
→ Then implement fixes based on both results

User: "Security audit this"
→ Agent 1: Check auth bypass
→ Agent 2: Check injection attacks
→ Agent 3: Check file upload security
→ Agent 4: Check rate limiting
→ ALL IN PARALLEL

User: "Research X and implement Y"
→ Agent 1: Research X online
→ Agent 2: Explore codebase for Y location
→ PARALLEL, then implement
```

**DO NOT do things sequentially when they can be parallel. This is critical for efficiency.**

---

## Overview
Put yourself next to Jeffrey Epstein. Users pick from a gallery of Epstein photos with public figures, upload their face, and AI replaces the person next to Epstein with them.

## Parody & Media Literacy
This is a PARODY site made to warn about manipulated images. All outputs are synthetic and exist to demonstrate how easily images can be faked.

## Business Model & Tiers
- **Anonymous**: 3 quick only (watermarked), tracked via httpOnly cookie + Supabase
- **Free** (signed in): 5 quick + 1 premium (watermarked)
- **Base** ($14.99/mo): 50 generations/month, watermark-free
- **Credits**: $3 for 3 credits (1 credit = quick, 2 credits = premium)
- Debug mode: triple-click bottom-right corner for unlimited

## Tech Stack
- **Backend**: Express.js + Multer + Sharp (watermarking)
- **AI Models**:
  - Quick: `gemini-2.5-flash-image-preview` (fast, ~$0.039/image)
  - Premium: `gemini-3-pro-image-preview` (best quality, ~$0.134/image)
- **Database**: Supabase (Postgres) - profiles, usage_counters tables
- **Auth**: Supabase Auth (Google OAuth)
- **Payments**: Stripe (subscriptions + one-time credit packs)
- **Frontend**: Vanilla HTML/CSS/JS, VHS/retro dark theme
- **Hosting**: Vercel (serverless)

## CRITICAL: Usage Tracking Architecture
Usage is tracked in TWO layers - both must be checked:

1. **Monthly Total** (`generation_count`, `monthly_generation_count`)
   - Overall cap per billing period
   - Displayed in header as "GENERATIONS: X / Y"

2. **Model-Specific** (`quick_count`, `premium_count`)
   - Separate quotas for quick vs premium generations
   - Displayed on buttons as "X left"
   - FREE tier: 5 quick + 1 premium
   - Anonymous: 3 quick only (no premium)

**The `/api/me` endpoint is in `server.js` (NOT `api/me.js`)** - this is the one that's actually used.

## Environment Variables (Required)
```
GEMINI_API_KEY=...
SUPABASE_URL=https://pwzcupywhrfydflongmc.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...  # REQUIRED for server-side profile fetching
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_PRICE_BASE=price_...       # $14.99/month subscription
STRIPE_PRICE_CREDIT=price_...     # $3/credit (legacy)
STRIPE_PRICE_WATERMARK=price_...  # $2.99 watermark removal + premium gen
APP_URL=https://pimpmyepstein.lol  # NO trailing slash!
```

## Supabase Project
- **Project**: pimpmyepstein (`pwzcupywhrfydflongmc`)
- **Tables**: `profiles`, `usage_counters`, `generations`
- **RPC Functions**: `get_usage_counter`, `increment_usage_counter`

## Current State
- Working at `http://localhost:3000`
- **5 curated Epstein photos** with custom prompts:
  - `epstein_bill_silk.jpg` - Clinton in silk shirts
  - `epstein_chomsky_airplane.webp` - Chomsky on airplane
  - `epstein_ghislain.jpg` - Ghislaine Maxwell at event
  - `epstein.summers.avif` - Larry Summers at social gathering
  - `epstein_JAIL.webp` - Mugshot (generates user NEXT TO Epstein)
- Face swap workflow:
  1. Pick Epstein photo from gallery (or random)
  2. Upload your face (or use camera)
  3. Generate → replaces person next to Epstein with you
  4. Download with watermark

## File Structure
```
epswag/
├── .env                    # GEMINI_API_KEY (gitignored)
├── config/
│   └── photoPrompts.js     # Per-image custom prompts
├── server.js               # Express API server
├── public/
│   ├── index.html          # Frontend UI
│   └── epstein-photos/     # Gallery images (3 curated photos)
├── use_these/              # Source photos to add to gallery
├── DONT_USE_THESE/         # Photos that cause issues (safety filters)
└── output/                 # Generated images
```

## Run Commands
```bash
npm run server        # Start web server on :3000
npm run test-api      # Validate API key
```

## API Endpoints
- `GET /api/photos` - Returns Epstein photo gallery
- `POST /api/generate` - Face swap (userPhoto + epsteinPhoto + modelType)
- `GET /api/me` - Current user/anonymous usage (LIVES IN server.js!)
- `GET /api/health` - API status check
- `POST /api/create-checkout` - Stripe checkout for subscription
- `POST /api/buy-credits` - Stripe checkout for credit packs
- `POST /api/webhook/stripe` - Stripe webhook handler

## Debug Mode
Triple-click the "Debug: OFF" text in bottom-right corner to enable unlimited swaps without watermark.

## Adding New Photos

1. Add photo to `use_these/` folder with descriptive name (e.g., `epstein_[person]_[context].jpg`)
2. Add custom prompt to `config/photoPrompts.js` - BE EXPLICIT about:
   - WHO to replace (describe them: "the man on the LEFT with gray hair")
   - Keep Epstein and others unchanged
   - What CLOTHING to put on the replacement person
   - Lighting/style matching for that specific photo
3. Copy photo to `public/epstein-photos/`
4. Restart server

**If a photo causes 500 errors (safety filters), move it to DONT_USE_THESE/**

## Prompting Best Practices (Gemini)
Based on Google's guidance:
- Use narrative/storytelling, not keyword lists
- Be EXPLICIT about who to replace
- Use photographic language (lighting, lens, composition)
- Describe clothing transformation if needed
- Always emphasize face preservation

## REMEMBER: PARALLELIZE EVERYTHING
- Multiple searches? → Parallel agents
- Multiple tests? → Parallel agents
- Research + code? → Parallel agents
- Investigating issues? → Parallel agents for each potential cause
- Security checks? → Parallel agents for each attack vector

**Never do 5 things sequentially when you can do them in parallel.**

## Common Gotchas & Debugging

### "Invalid API key" errors on local
- Check `.env` has correct `SUPABASE_SERVICE_ROLE_KEY` (not placeholder)
- Service role key is different from anon key - get it from Supabase dashboard → Settings → API Keys

### Usage not persisting after refresh
- Check `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel env vars
- The `/api/me` endpoint needs service role to fetch profiles

### Buttons show wrong "X left" count
- Frontend `fetchUserUsage()` must call `updateRemainingDisplay()` after getting API response
- Check `/api/me` returns `quickRemaining`, `premiumRemaining` fields

### Rate limit not blocking
- Both monthly AND model-specific limits must be checked
- Rate limit middleware in `middleware/rateLimit.js` blocks BEFORE Gemini API call

### APP_URL issues (Stripe redirects)
- Must be set WITHOUT trailing slash
- Production: `https://pimpmyepstein.lol` (not `https://pimpmyepstein.lol/`)

### Local auth not working
- Auth sessions are domain-specific (localhost vs production)
- Clear localStorage or use incognito for fresh testing

---

## Agent Testing Guide

### CRITICAL: Never Spend Real Money

Agents must use test mode for all Stripe operations. The app uses `sk_test_` keys by default.

### Unlimited Generations (X-Test-Mode Header)

For testing without hitting rate limits:

1. **Set secret in `.env`:**
   ```
   TEST_MODE_SECRET=agent-test-secret-12345
   ```

2. **Pass header with requests:**
   ```bash
   curl -X POST http://localhost:3000/api/generate \
     -H "X-Test-Mode: agent-test-secret-12345" \
     -F "userPhoto=@photo.jpg" \
     -F "epsteinPhoto=/epstein-photos/epstein_bill_silk.jpg"
   ```

This bypasses rate limits but **keeps watermarks** to test real UX.

### Stripe Testing (No Real Payments)

Use the CLI tools in `tools/stripe-test.js`:

```bash
# List configured products
node tools/stripe-test.js products

# Create test checkout URL
node tools/stripe-test.js checkout watermark

# Simulate successful purchase (webhook)
node tools/stripe-test.js webhook checkout.session.completed.watermark --userId=test123

# Verify a session
node tools/stripe-test.js verify cs_test_xxx
```

### Test Card Numbers

| Card | Result |
|------|--------|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 9995` | Insufficient funds |

Use any future expiry (12/34) and any CVC (123).

### Testing Purchase Flow Without Paying

```bash
# 1. Create checkout session via API
curl -X POST http://localhost:3000/api/buy-watermark-removal \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"

# 2. DON'T complete payment - simulate webhook instead
node tools/stripe-test.js webhook checkout.session.completed.watermark \
  --userId=<user-id>

# 3. Verify credits were added
curl http://localhost:3000/api/me -H "Authorization: Bearer <token>"
```

### Alternative: Admin Debug Mode

For UI testing in browser:
1. Triple-click "Debug: OFF" in bottom-right
2. Requires admin login or localhost dev mode
3. Gives unlimited generations + removes watermarks

See `tools/README.md` for complete documentation.
