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
- **Anonymous**: 3 quick + 1 premium (watermarked), tracked via httpOnly cookie + Supabase
- **Free** (signed in): 5 quick + 1 premium (watermarked)
- **Base** ($14.99/mo): 50 generations/month, watermark-free
- **Credits**: $3 for 3 credits (1 credit = quick, 2 credits = premium)
- Debug mode: triple-click bottom-right corner for unlimited

## Tech Stack
- **Backend**: Express.js + Multer + Sharp (watermarking)
- **AI Models**:
  - Quick: `gemini-2.0-flash-exp` (fast, 5-10 sec)
  - Premium: `gemini-3-pro-image-preview` (best quality, 15-30 sec)
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
   - Anonymous: 3 quick + 1 premium

**The `/api/me` endpoint is in `server.js` (NOT `api/me.js`)** - this is the one that's actually used.

## Environment Variables (Required)
```
GEMINI_API_KEY=...
SUPABASE_URL=https://pwzcupywhrfydflongmc.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...  # REQUIRED for server-side profile fetching
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_PRICE_BASE=price_...
STRIPE_PRICE_CREDIT=price_...
APP_URL=https://pimpmyepstein.lol  # NO trailing slash!
```

## Supabase Project
- **Project**: pimpmyepstein (`pwzcupywhrfydflongmc`)
- **Tables**: `profiles`, `usage_counters`, `generations`
- **RPC Functions**: `get_usage_counter`, `increment_usage_counter`

## Current State
- Working at `http://localhost:3000`
- **3 curated Epstein photos** with custom prompts:
  - `epstein_bill_silk.jpg` - Clinton in silk shirts
  - `epstein_chomsky_airplane.webp` - Chomsky on airplane
  - `epstein_woodyallen_coat.png` - Woody Allen in hooded coat
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
