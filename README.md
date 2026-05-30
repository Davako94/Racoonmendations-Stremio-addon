# 🦝 Raccoonmendations - Stremio Addon

> **Personalized movie & series recommendations powered by TMDB** — Works with Stremio, AIOMetadata, and all Stremio catalog aggregators!

![Raccoonmendations Logo](src/public/logo.png)

## ✨ Features

- 🎬 **Personalized Recommendations** - Get "Similar to [Movie/Series]" catalogs based on your favorite content
- 🔄 **Random selection** - Random content from your selected titles, it change with every manifest.json you install
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
4. Manifest URL created: https://raccoonmendations-stremio-addon.vercel.app/{UUID}/manifest.json
5. Install in Stremio/AIOMetadata
6. Every hour, catalogs rotate to show different "Similar to..." recommendations
```

### Random Selection

**manifest 1:**
- 🎬 Similar to Fight Club
- 🎬 Similar to Godfather  
- 🎬 Similar to Pulp Fiction
- 📺 Similar to Game of Thrones
- 📺 Similar to Breaking Bad
- ✨ Popular Movies
- ✨ Popular Series

**manifest 2:** 
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

Add your URL manifest to AIOMetadata - Catalog - Custom manifest:
```
https://raccoonmendations-stremio-addon.vercel.app/{UUID}/manifest.json
```

**Available AIOMetadata Instances:**
- 🌐 [aiometadata viren070](https://aiometadata.viren070.me/configure/)
- 🌐 [aiometadatafortheweebs.midnightignite](https://aiometadatafortheweebs.midnightignite.me/configure/)
- 🌐 [aiometadata elfhosted](https://aiometadata.elfhosted.com/configure/)
- 🌐 [aiometadata fortheweak cloud](https://aiometadata.fortheweak.cloud/configure/)
- 🌐 [aiometadata fortheweak nhyira](https://aiometadatafortheweak.nhyira.dev/configure/)

### Option 3: Other Aggregators

Works with any Stremio-compatible catalog aggregator:
- Copy this URL: `https://raccoonmendations-stremio-addon.vercel.app/{UUID}/manifest.json`
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
2. **import custom catalogs** - You can move the catalogs where you prefer
3. **See you random elements from your selection** - New recommendations appear every manifest you install
4. **Install on Stremio** - Follow Stremio setup to personalize

### Searching for Content //next update//

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
- TMDB API key (pre-installed)
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

### Catalogs not change
- Reinstall addon: Stremio → Add-ons → Raccoonmendations → install manifest again or you can use:
  🌐 [stremio-manager](https://stremio-manager.com/) for a fast reinstall!

- Clear stremio cache

## 💡 Tips & Tricks

- **Export selections** - Your UUID preserves your choices indefinitely
- **Share addon** - Share your UUID manifest URL with others (they'll get your public recommendations)
- **Update preferences** - Revisit `/configure` with same email to modify selections

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
