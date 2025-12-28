# Pimp My Epstein - AI Face Swap App

## Overview
Put yourself next to Jeffrey Epstein. Users pick from a gallery of Epstein photos with public figures, upload their face, and AI replaces the person next to Epstein with them.

## Parody & Media Literacy
This is a PARODY site made to warn about manipulated images. All outputs are synthetic and exist to demonstrate how easily images can be faked.

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
- 10 Epstein photos in gallery
- Face swap workflow:
  1. Pick Epstein photo from gallery (or random)
  2. Upload your face
  3. Generate → replaces person next to Epstein with you
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
│   └── epstein-photos/      # Gallery images (10 photos)
└── output/                 # Generated images
```

## Run Commands
```bash
npm run server        # Start web server on :3000
npm run test-api      # Validate API key
```

## API Endpoints
- `GET /api/photos` - Returns Epstein photo gallery
- `POST /api/generate` - Face swap (userPhoto + epsteinPhoto path)
- `GET /api/health` - API status check

## Debug Mode
Triple-click the "Debug: OFF" text in bottom-right corner to enable unlimited swaps without watermark.

## Future Roadmap
- [ ] Supabase integration (Google OAuth, usage tracking)
- [ ] Vercel deployment (serverless functions)
- [ ] Stripe for $20/mo tier
- [ ] More Epstein photos with public figures
- [ ] Rate limiting per user

## Key Architecture Decisions
- **Watermark via Sharp SVG overlay** - Lightweight, no heavy deps
- **localStorage for usage tracking** - Simple MVP, migrate to Supabase later
- **Epstein photo gallery served statically** - Easy to add/remove photos
- **Debug mode hidden** - Triple-click activation for testing

## MCP Configuration Notes
**If Vercel/Supabase MCPs fail to connect:**
- HTTP OAuth method (`https://mcp.vercel.com`, `https://mcp.supabase.com/mcp`) often fails with "Failed to reconnect" - Claude Code's browser OAuth flow doesn't complete properly
- **Use stdio method with direct API tokens instead:**
  ```bash
  # Vercel - pass API key as CLI argument (NOT env var)
  claude mcp add vercel -s user -- npx -y vercel-mcp "VERCEL_API_KEY=<token>"

  # Supabase - use SUPABASE_ACCESS_TOKEN env var (personal access token, starts with sbp_)
  claude mcp add supabase -s user -e SUPABASE_ACCESS_TOKEN=<token> -- npx -y @supabase/mcp-server-supabase
  ```
- Vercel token: Get from https://vercel.com/account/tokens
- Supabase token: Get from https://supabase.com/dashboard/account/tokens (use Personal Access Token, NOT service role key)
