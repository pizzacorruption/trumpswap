# Trump Swap - AI Face Swap App

## Overview
Put yourself next to Trump! Users pick from a gallery of Trump photos, upload their face, and AI replaces the person next to Trump with them.

## Business Model
- 3 free swaps (tracked in localStorage)
- Debug mode for unlimited (triple-click bottom-right corner)
- Watermark on all free tier images
- Future: $20/mo unlimited tier, Google auth via Supabase

## Tech Stack
- **Backend**: Express.js + Multer + Sharp (watermarking)
- **AI Model**: `gemini-3-pro-image-preview` (Nano Banana Pro)
- **API Key**: Stored in `.env` as `GEMINI_API_KEY`
- **Frontend**: Vanilla HTML/CSS/JS, SHOWFEETS-inspired dark theme

## Current State
- Working at `http://localhost:3000`
- 14 Trump photos in gallery
- Face swap workflow:
  1. Pick Trump photo from gallery (or random)
  2. Upload your face
  3. Generate → replaces person next to Trump with you
  4. Download with watermark

## File Structure
```
epswag/
├── .env                    # GEMINI_API_KEY (gitignored)
├── .env.example            # Template
├── .gitignore
├── package.json
├── server.js               # Express API server
├── poc.js                  # CLI version (legacy)
├── test-api.js             # API key validation
├── public/
│   ├── index.html          # Frontend UI (SHOWFEETS style)
│   └── trump-photos/       # Gallery images (14 photos)
└── output/                 # Generated images
```

## Run Commands
```bash
npm run server        # Start web server on :3000
npm run test-api      # Validate API key
```

## API Endpoints
- `GET /api/photos` - Returns Trump photo gallery
- `POST /api/generate` - Face swap (userPhoto + trumpPhoto path)
- `GET /api/health` - API status check

## Debug Mode
Triple-click the "Debug: OFF" text in bottom-right corner to enable unlimited swaps without watermark.

## Future Roadmap
- [ ] Supabase integration (Google OAuth, usage tracking)
- [ ] Vercel deployment (serverless functions)
- [ ] Stripe for $20/mo tier
- [ ] More Trump photos
- [ ] Rate limiting per user

## Key Architecture Decisions
- **Watermark via Sharp SVG overlay** - Lightweight, no heavy deps
- **localStorage for usage tracking** - Simple MVP, migrate to Supabase later
- **Trump photo gallery served statically** - Easy to add/remove photos
- **Debug mode hidden** - Triple-click activation for testing
