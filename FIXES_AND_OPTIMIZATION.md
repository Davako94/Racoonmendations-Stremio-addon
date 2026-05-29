# Raccoonmendations - Fixes & Optimization Guide

## ✅ Fixed Issues

### 1. **Catalogs Not Refreshing After 1 Hour**

**Problem:** Installed catalogs displayed old content even with hourly rotation logic.

**Root Causes:**
- Server-side cache was set to 24 hours (`stdTTL: 86400`)
- HTTP responses used `Cache-Control: no-cache` which prevented proper cache refresh
- Stremio was caching responses incorrectly

**Solutions Applied:**

#### A) Reduced Server-Side Cache to 1 Hour
**File:** `src/handlers/catalog.js`
```javascript
// Before: stdTTL: 86400 (24 hours)
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
// After: stdTTL: 3600 (1 hour), checks every 10 minutes
```

#### B) Added Proper Cache-Control Headers for Catalog Responses
**File:** `index.js`
```javascript
// New function for catalog responses
const setCatalogCacheHeaders = (res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Pragma', 'cache');
};
```

This tells clients (Stremio, browsers) and CDNs:
- `public`: Can be cached by anyone
- `max-age=3600`: Cache expires after 1 hour (3600 seconds)
- `Pragma: cache`: Ensures compatibility with older clients

#### C) Updated Catalog Endpoints
All catalog endpoints now use `setCatalogCacheHeaders(res)` instead of `setNoCacheHeaders(res)`:
```
GET /catalog/:type/:catalogId.json
GET /:uuid/catalog/:type/:catalogId.json
GET /stremio/:uuid/catalog/:type/:catalogId.json
GET /stremio/:uuid/:compressedConfig/catalog/:type/:catalogId.json
```

**Result:** Catalogs will now refresh every hour, synchronized with your hourly seed rotation.

---

### 2. **AIOMetadata Compatibility**

Your manifest is already well-structured for AIOMetadata compatibility! ✅

**Current Implementation:**
```javascript
{
  id: "raccoonmendations",
  version: "3.2.0",
  name: "Raccoonmendations",
  resources: ["catalog", "meta"],           // ✓ Required
  types: ["movie", "series"],               // ✓ Required
  catalogs: [                               // ✓ Required
    {
      type: "movie",
      id: "similar_tmdb:123_uuid",
      name: "🎬 Similar to...",
      extra: [                              // ✓ Important for aggregators
        { name: "skip", isRequired: false },
        { name: "search", isRequired: false }
      ]
    }
  ],
  idPrefixes: ["tt", "tmdb:"],             // ✓ Critical for filtering
  behaviorHints: {
    configurable: true,
    configurationRequired: false
  }
}
```

**What AIOMetadata Expects:**
- ✅ `id`: Unique addon identifier
- ✅ `version`: Semantic versioning
- ✅ `resources`: What the addon provides (catalog, meta, stream, etc.)
- ✅ `types`: Content types (movie, series, channel, etc.)
- ✅ `catalogs`: Available catalogs with unique IDs
- ✅ `idPrefixes`: Helps aggregators match content (tt = IMDb, tmdb: = TMDB)
- ✅ `behaviorHints`: How Stremio should handle the addon

**No Changes Needed** - Your implementation is compliant!

---

## 🔄 How Hourly Rotation Works (Already Implemented)

Your addon uses a deterministic hourly rotation system:

```javascript
function getHourlySeed(userUuid) {
  const hourIndex = Math.floor(Date.now() / 3600000);
  const hash = crypto.createHash('sha256').update(`${userUuid}:${hourIndex}`).digest();
  return hash.readUInt32LE(0);
}
```

**How it works:**
1. Calculates the current hour index (changes every 3600 seconds)
2. Hashes `UUID:hourIndex` to get a deterministic seed
3. Uses the seed to shuffle selected content
4. Same user gets same results in the same hour
5. Different hour = different results

**Result:** Every hour, the manifest returns a different rotation of catalogs automatically.

---

## 📊 Cache Timeline (Updated)

### Before
```
Hour 1  → Manifest returned, cached 24 hours by server
Hour 2  → Server still serving old cache from Hour 1
Hour 24 → Finally refreshes
```

### After
```
Hour 1  → Manifest returned, cached 1 hour by server & client
Hour 2  → Cache expires, new manifest with rotated catalogs returned
Hour 3  → Cache expires, new manifest with rotated catalogs returned
(Repeats every hour)
```

---

## 🧪 Testing the Fixes

### Test 1: Verify 1-Hour Refresh
1. Install the addon in Stremio
2. Note the catalogs displayed
3. Wait 1 hour
4. Refresh Stremio or remove/reinstall addon
5. Catalogs should have rotated to different content

### Test 2: Check Cache Headers
In browser DevTools or via curl:
```bash
curl -i https://your-addon.vercel.app/catalog/movie/rec_YOUR_UUID.json
```

Look for:
```
Cache-Control: public, max-age=3600
```

### Test 3: AIOMetadata Integration
- Add your addon URL to AIOMetadata
- Should recognize all catalogs
- Should display correct content type icons
- Catalogs should rotate hourly

---

## 🚀 Additional Recommendations

### 1. **Add ETag Support** (Optional Enhancement)
For efficient client-side caching, add ETag headers:

```javascript
const crypto = require('crypto');

const getCatalogETag = (catalogId, uuid) => {
  const hourIndex = Math.floor(Date.now() / 3600000);
  const data = `${catalogId}:${uuid}:${hourIndex}`;
  return `"${crypto.createHash('md5').update(data).digest('hex')}"`;
};

app.get('/:uuid/catalog/:type/:catalogId.json', async (req, res) => {
  setCatalogCacheHeaders(res);
  
  const eTag = getCatalogETag(req.params.catalogId, req.params.uuid);
  res.setHeader('ETag', eTag);
  
  if (req.headers['if-none-match'] === eTag) {
    return res.status(304).end(); // Not Modified
  }
  
  // ... rest of handler
});
```

This allows clients to validate if content changed without re-downloading.

### 2. **Monitor Cache Hit Rates**
Add logging to see if caching is working:

```javascript
const cacheStats = {
  hits: 0,
  misses: 0
};

app.get('/:uuid/catalog/:type/:catalogId.json', async (req, res) => {
  const cacheKey = `${req.params.catalogId}:${req.params.uuid}`;
  const cached = cache.get(cacheKey);
  
  if (cached) {
    cacheStats.hits++;
    console.log(`Cache HIT: ${cacheKey} (${cacheStats.hits}/${cacheStats.hits + cacheStats.misses})`);
  } else {
    cacheStats.misses++;
    console.log(`Cache MISS: ${cacheKey}`);
  }
});
```

### 3. **Consider Shorter Cache for Quick Updates**
If you want faster updates during development:
```javascript
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes instead of 1 hour
```

### 4. **Add Vary Header** (Already Done ✓)
Your code already includes:
```javascript
res.setHeader('Vary', 'Origin');
```
This tells proxies to cache responses per origin, which is correct.

---

## 📋 Summary of Changes

| File | Change | Impact |
|------|--------|--------|
| `src/handlers/catalog.js` | Cache TTL: 86400s → 3600s | Catalogs refresh hourly |
| `index.js` | New `setCatalogCacheHeaders()` | Proper HTTP caching directives |
| `index.js` | Updated catalog endpoints | Use new cache headers |

---

## ✨ Why This Fixes Your Problem

**Before:** 
- Server cached for 24 hours
- Client cached because headers said "no-cache" but didn't specify refresh time
- Result: Same catalogs for 24 hours

**After:**
- Server caches for 1 hour
- Client caches for exactly 1 hour (Cache-Control: max-age=3600)
- Hourly manifest rotation generates new seed
- Result: Different catalogs every hour, automatically! 🎉

---

## 🔗 References

- [Stremio Addon SDK Docs](https://github.com/Stremio/stremio-addon-sdk)
- [HTTP Cache-Control Header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control)
- [Stremio Manifest Specification](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md)
- [AIOMetadata Project](https://github.com/Efensio/AIOMetadata) (if applicable)
