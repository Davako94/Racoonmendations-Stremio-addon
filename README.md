# 🦝 Raccoonmendations - Stremio Addon

> **Personalized movie & series recommendations powered by TMDB** — Works with Stremio, AIOMetadata, and all Stremio catalog aggregators!

![Raccoonmendations Logo](src/public/logo.png)

## ✨ Features

- 🎬 **Personalized Recommendations** - Get "Similar to [Movie/Series]" catalogs based on your favorite content
- 🔄 **Hourly Rotation** - Catalogs automatically refresh every hour with new content from your selected titles
- 🌍 **Multi-Platform Support** - Install on Stremio, AIOMetadata, or any Stremio-compatible platform
- 🎯 **Smart Aggregation** - Combines TMDB recommendations with similarity scores for better results
- ⚡ **Fast & Cacheable** - Optimized HTTP caching for instant catalog loading
- 🔐 **User Isolation** - Each user gets unique personalized recommendations via UUID

## 📖 How It Works

### Workflow

```
1. User visits /configure → Logs in with Stremio credentials
2. Selects 5+ favorite movies & 5+ favorite series
3. Addon generates unique UUID for user
4. Manifest URL created: https://addon.vercel.app/{UUID}/manifest.json
5. Install in Stremio/AIOMetadata
6. Every hour, catalogs rotate to show different "Similar to..." recommendations
```

### Hourly Rotation Example

**Hour 1:**
- 🎬 Similar to Fight Club
- 🎬 Similar to Godfather  
- 🎬 Similar to Pulp Fiction
- 📺 Similar to Game of Thrones
- 📺 Similar to Breaking Bad
- ✨ Popular Movies
- ✨ Popular Series

**Hour 2:** (Auto-refreshes)
- 🎬 Similar to Inception
- 🎬 Similar to Interstellar
- 🎬 Similar to Shawshank Redemption
- 📺 Similar to Stranger Things
- 📺 Similar to The Office
- ✨ Popular Movies
- ✨ Popular Series

## 🚀 Installation

### Option 1: Stremio (Personalized)

1. Visit: **[Raccoonmendations Configure Page](https://raccoonmendations-stremio-addon.vercel.app/configure)**
2. Login with your **Stremio email & password**
3. Select **5+ movies** and **5+ series** from your library
4. Click **"Generate my Addon"**
5. Copy the generated manifest URL
6. Open Stremio → **Add-ons** → **Install from URL** → Paste URL
7. ✅ Done! Your personalized recommendations will now appear

### Option 2: AIOMetadata (Public Demo)

Add this URL to AIOMetadata:
```
https://raccoonmendations-stremio-addon.vercel.app/manifest.json
```

**Available AIOMetadata Instances:**
- 🌐 [AIOMetadata Official](https://www.aiometadata.com/)
- 🌐 [AIOMetadata Community](https://aiometadata.github.io/)
- 🌐 [Streamline (Fork)](https://streamline.vercel.app/)
- 🌐 [Stremio Manager](https://stremio-manager.web.app/)

**Includes 10 rotating demo catalogs:**
- Similar to popular movies (changes hourly)
- Similar to popular series (changes hourly)
- Popular movies & series

### Option 3: Other Aggregators

Works with any Stremio-compatible catalog aggregator:
- Copy this URL: `https://raccoonmendations-stremio-addon.vercel.app/manifest.json`
- Add to your aggregator's addon sources
- Public demo mode will be available

## 🎮 Usage Guide

### For Stremio Users

1. **Install the addon** (see Installation → Option 1)
2. **Browse catalogs** - New "Similar to..." sections appear in Stremio
3. **Wait for hourly refresh** - Catalogs automatically rotate every hour
4. **Update preferences** - Revisit `/configure` to change your selections

### For AIOMetadata Users

1. **Add the addon URL** to AIOMetadata catalog sources
2. **Discover demo content** - Browse popular movies/series
3. **See hourly rotations** - New recommendations appear every hour
4. **Install on Stremio** - Follow Stremio setup to personalize

### Searching for Content

The configure page includes an advanced search:

1. Go to [Configure Page](https://raccoonmendations-stremio-addon.vercel.app/configure)
2. **After login**, scroll to "Advanced Search"
3. Type movie/series name in search box
4. Browse recommendations for that title
5. Click to add/remove from your selections
6. Generate your addon when done

## 🔧 Technical Details

### Architecture

```
Client (Stremio/AIOMetadata)
    ↓
Express Server (Vercel)
    ├── /manifest.json → Returns addon configuration
    ├── /catalog/:type/:id.json → Returns catalog metadata
    ├── /meta/:type/:id.json → Returns detailed metadata
    ├── /configure → Configuration UI
    └── /api/* → Internal APIs
    ↓
TMDB API (Metadata & Recommendations)
    ↓
Supabase (User Configuration Storage)
```

### Caching Strategy

- **Manifest**: Cached for 1 hour (allows hourly rotation)
- **Catalogs**: Cached for 1 hour (server-side with NodeCache)
- **Meta**: Cached for 24 hours (static content)
- **Images**: Cached for 1 week

### Hourly Seed Generation

```javascript
// Deterministic hourly rotation
const hourIndex = Math.floor(Date.now() / 3600000);
const seed = hash(`${userUUID}:${hourIndex}`);

// Same user, same hour = same catalogs (across devices)
// Different hour = different catalogs (auto-refresh)
```

## 📊 Screenshots

### Configuration Page
![Configure Screenshot - Login]([SCREENSHOT_PATH_LOGIN])
![Configure Screenshot - Selection]([SCREENSHOT_PATH_SELECTION])
![Configure Screenshot - Result]([SCREENSHOT_PATH_RESULT])

### Stremio Integration
![Stremio - Catalogs]([SCREENSHOT_PATH_STREMIO])
![Stremio - Similar To]([SCREENSHOT_PATH_SIMILAR])

### AIOMetadata
![AIOMetadata - Discovery]([SCREENSHOT_PATH_AIOMETADATA])
![AIOMetadata - Hourly Rotation]([SCREENSHOT_PATH_ROTATION])

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js, Express.js
- **Hosting**: Vercel (Serverless)
- **Database**: Supabase (PostgreSQL)
- **API**: TMDB (Movie/Series Data)
- **Authentication**: Stremio User Email
- **Addon Protocol**: Stremio Addon Specification

## 📝 Requirements

- Stremio account (for authentication)
- TMDB API key (handled by addon)
- 5+ favorite movies selected
- 5+ favorite series selected

## 🌐 Public API

### GET /manifest.json
Returns public addon manifest (demo mode)

```json
{
  "id": "raccoonmendations",
  "version": "3.2.0",
  "name": "Raccoonmendations",
  "resources": ["catalog", "meta"],
  "types": ["movie", "series"],
  "catalogs": [...]
}
```

### GET /{UUID}/manifest.json
Returns personalized addon manifest (user mode)

### GET /catalog/:type/:catalogId.json
Returns catalog items

```json
{
  "metas": [
    {
      "id": "tmdb:123",
      "type": "movie",
      "name": "Movie Title",
      "poster": "https://...",
      "description": "..."
    }
  ]
}
```

### GET /meta/:type/:id.json
Returns detailed metadata

## 🔐 Privacy & Security

- ✅ **No password storage** - We use Stremio's email for identification only
- ✅ **UUID-based isolation** - Each user has unique, unguessable identifier
- ✅ **HTTPS only** - All communications encrypted
- ✅ **No personal data** - Only storing movie/series selections
- ✅ **Read-only access** - Never modifies your Stremio account

## 🐛 Troubleshooting

### "Network Error fetching metadata"
- Check addon URL is correct
- Verify UUID is present in URL
- Clear browser cache and retry

### "Manifest Generated" but catalogs won't load
- Ensure 5+ movies AND 5+ series are selected
- Refresh addon in Stremio settings
- Wait 1 minute for server cache to clear

### Catalogs not rotating after 1 hour
- Refresh addon: Stremio → Add-ons → [Addon name] → Refresh
- Clear browser cache
- Check server logs for errors

### Searching shows no results
- Try more specific search terms
- Check TMDB website if title exists
- Try without special characters

## 💡 Tips & Tricks

- **Export selections** - Your UUID preserves your choices indefinitely
- **Share addon** - Share your UUID manifest URL with others (they'll get public recommendations)
- **Update preferences** - Revisit `/configure` with same email to modify selections
- **Test rotations** - Check if catalogs change by viewing at different times
- **Bookmark URL** - Save your personal manifest URL as bookmark

## 🤝 Contributing

Found a bug? Have a feature request? 

1. Check [Issues](../../issues)
2. Create a new issue with details
3. Submit a pull request with fixes

## 📄 License

MIT License - Feel free to fork, modify, and use!

## 🙏 Acknowledgments

- **TMDB** - Movie & series data
- **Stremio** - Addon protocol & platform
- **Vercel** - Hosting & deployment
- **Supabase** - Backend database

## 📧 Support

Having issues? 

- 📖 Read [Troubleshooting](#-troubleshooting)
- 🐛 [Report a bug](../../issues/new)
- 💬 [Start a discussion](../../discussions)

## 🦝 About

**Raccoonmendations** makes discovering new movies and series fun by combining your taste with intelligent recommendations. It works seamlessly across Stremio, AIOMetadata, and other aggregators!

---

**Made with ❤️ for Stremio enthusiasts**

Visit: https://raccoonmendations-stremio-addon.vercel.app
