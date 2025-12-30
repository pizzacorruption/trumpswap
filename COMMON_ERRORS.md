# Common Errors & Fixes

A living document of recurring issues and their solutions.

---

## 1. Image Not Displaying (Broken Image Icon)

**Symptom**: Generated image shows broken image icon with alt text "Your pimped Epstein" instead of the actual image.

**Root Cause**: The frontend code was appending `?viewToken=xxx` to ALL image URLs, including base64 data URLs. Data URLs (`data:image/png;base64,...`) don't support query parameters - adding them breaks the URL.

**Where**: `public/index.html` - generation response handler

**Bad Code**:
```javascript
let imageUrl = data.imageUrl;
if (data.viewToken) {
  imageUrl += `?viewToken=${data.viewToken}`;  // BREAKS data URLs!
}
```

**Fixed Code**:
```javascript
let imageUrl = data.imageUrl;
if (data.viewToken && imageUrl && !imageUrl.startsWith('data:')) {
  imageUrl += `?viewToken=${data.viewToken}`;
}
```

**Why This Matters**:
- Local server (`server.js`) returns file paths: `/output/epstein_xxx.png`
- Vercel serverless (`api/generate.js`) returns base64 data URLs: `data:image/png;base64,...`
- Only file path URLs need the viewToken query param for auth

**Fixed in commit**: e3fa6c0 (or subsequent)

---

## 2. Watermark Shows Square Boxes Instead of Text

**Symptom**: Watermark appears as `□□□□□□□□□□□□□` instead of "pimpmyepstein.lol"

**Root Cause**: libvips SVG font rendering fails on Vercel serverless containers that lack system fonts.

**Solution**: Use pre-rendered PNG watermark instead of runtime SVG text generation.

**Where**: `lib/watermark.js`

**Key Files**:
- `lib/watermark.js` - Uses embedded base64 PNG
- `scripts/generate-watermark.js` - Regenerate watermark locally if needed

**Fixed in commit**: 19f9b4e

---

## 3. UNLOCK NOW Button Not Working (Anonymous Users)

**Symptom**: Clicking "UNLOCK NOW" does nothing for anonymous users.

**Root Cause**: The Vercel serverless `api/generate.js` wasn't returning `generationId` and `viewToken` in the response, which are required for creating Stripe checkout sessions.

**Where**: `api/generate.js`

**Fix**: Added generation record creation and included `generationId`/`viewToken` in API response.

**Fixed in commit**: e3fa6c0

---

## 4. Usage Not Persisting After Refresh

**Symptom**: Anonymous usage resets after page refresh.

**Root Cause**: Missing `SUPABASE_SERVICE_ROLE_KEY` in Vercel environment variables.

**Fix**: Ensure all required env vars are set in Vercel dashboard:
- `SUPABASE_SERVICE_ROLE_KEY` (different from anon key!)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

---

## 5. Stripe "Not a valid URL" Error

**Symptom**: Checkout fails with URL validation error.

**Root Cause**: `APP_URL` environment variable has trailing slash or is malformed.

**Fix**: Set `APP_URL` without trailing slash:
- Correct: `https://pimpmyepstein.lol`
- Wrong: `https://pimpmyepstein.lol/`

---

## Adding New Entries

When fixing a recurring bug:
1. Add entry here with symptom, root cause, location, and fix
2. Include commit hash for reference
3. Keep explanations brief but complete
