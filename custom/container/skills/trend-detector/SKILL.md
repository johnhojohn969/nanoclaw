# Trend Detector

Detect trending content topics for social media posts using free/low-cost APIs and scraping methods.

---

## Overview

| Source | Method | Auth needed |
|---|---|---|
| Google Trends | pytrends (unofficial) or SerpAPI | No / SerpAPI key optional |
| Reddit | Public `.json` endpoint | None |
| Twitter/X | Nitter scraping | None |
| YouTube | Data API v3 `videos?chart=mostPopular` | API key (free quota) |
| Relevance scoring | Local Python function | None |

---

## 1. Google Trends

### Option A — pytrends (no API key, unofficial)

```bash
pip install pytrends
```

```python
from pytrends.request import TrendReq
import pandas as pd

pt = TrendReq(hl='en-US', tz=360)

# Trending searches in a country (no keyword needed)
trending = pt.trending_searches(pn='united_states')
print(trending.head(20).to_string())

# Interest over time for a keyword
pt.build_payload(['ancient civilizations', 'AI art'], timeframe='now 7-d', geo='US')
iot = pt.interest_over_time()
print(iot.tail())

# Related queries — find rising breakout topics
related = pt.related_queries()
for kw, data in related.items():
    rising = data.get('rising')
    if rising is not None:
        print(f"\n--- Rising for '{kw}' ---")
        print(rising.head(10).to_string())
```

> Note: pytrends uses an unofficial scraping layer. Google may throttle. Add `requests_args={'headers': {'User-Agent': 'Mozilla/5.0'}}` to `TrendReq()` if blocked.

### Option B — SerpAPI (paid, ~100 free searches/month)

```bash
SERP_KEY="your_serpapi_key"
QUERY="ancient+civilizations"

curl -s "https://serpapi.com/search.json?engine=google_trends&q=${QUERY}&data_type=TIMESERIES&api_key=${SERP_KEY}" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
for pt in d.get('interest_over_time', {}).get('timeline_data', [])[-5:]:
    print(pt['date'], pt['values'])
"
```

```bash
# Real-time trending searches via SerpAPI
curl -s "https://serpapi.com/search.json?engine=google_trends_trending_now&geo=US&api_key=${SERP_KEY}" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
for item in d.get('trending_searches', [])[:20]:
    print(item.get('query'), '—', item.get('search_volume',''))
"
```

---

## 2. Reddit Trending

No auth required. JSON available on any public subreddit.

```bash
SUBREDDIT="ArtificialIntelligence"  # change to any subreddit

curl -s -H "User-Agent: NanoClaw/1.0" \
  "https://www.reddit.com/r/${SUBREDDIT}/hot.json?limit=25" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
posts = d['data']['children']
for p in posts:
    post = p['data']
    print(f\"{post['score']:>6}  {post['title'][:80]}\")
"
```

```python
import requests

def reddit_hot_titles(subreddit: str, limit: int = 25) -> list[dict]:
    """Return top hot posts from a subreddit."""
    url = f"https://www.reddit.com/r/{subreddit}/hot.json"
    headers = {"User-Agent": "NanoClaw/1.0"}
    r = requests.get(url, headers=headers, params={"limit": limit}, timeout=10)
    r.raise_for_status()
    posts = r.json()["data"]["children"]
    return [
        {
            "title": p["data"]["title"],
            "score": p["data"]["score"],
            "url": p["data"]["url"],
            "flair": p["data"].get("link_flair_text", ""),
            "comments": p["data"]["num_comments"],
        }
        for p in posts
    ]

# Multiple subreddits in one sweep
SUBREDDITS = ["ArtificialIntelligence", "HistoryMemes", "DigitalArt", "pics", "videos"]
all_posts = []
for sub in SUBREDDITS:
    try:
        all_posts.extend(reddit_hot_titles(sub))
    except Exception as e:
        print(f"[warn] {sub}: {e}")

# Sort by score
all_posts.sort(key=lambda x: x["score"], reverse=True)
for p in all_posts[:15]:
    print(f"{p['score']:>7}  [{p['flair'] or '—'}]  {p['title'][:70]}")
```

> Rate limit: Reddit allows ~60 requests/minute unauthenticated. Sleep 1s between calls when scraping many subreddits.

---

## 3. Twitter/X Trends

Twitter's official API requires a paid plan ($100+/month). Use Nitter (open-source Twitter front-end) or scrape trends from third-party aggregators instead.

### Option A — Nitter (self-hosted or public instance)

```bash
# Get trending topics from a public Nitter instance
# List of instances: https://github.com/zedeus/nitter/wiki/Instances
NITTER="https://nitter.poast.org"

curl -s -A "Mozilla/5.0" "${NITTER}/search/trending" \
  | python3 -c "
import sys, re
html = sys.stdin.read()
# Nitter renders trends in <a class='trend-link'>
trends = re.findall(r'class=[\"'"'"']trend-link[\"'"'"'][^>]*>([^<]+)<', html)
for t in trends[:20]:
    print(t.strip())
"
```

### Option B — trends24.in (no auth, public aggregator)

```python
import requests
from bs4 import BeautifulSoup

def get_twitter_trends(country_code: str = "united-states") -> list[str]:
    """Scrape Twitter trends from trends24.in."""
    url = f"https://trends24.in/{country_code}/"
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
    r = requests.get(url, headers=headers, timeout=10)
    soup = BeautifulSoup(r.text, "html.parser")
    trends = []
    for a in soup.select(".trend-card__list a"):
        text = a.get_text(strip=True)
        if text:
            trends.append(text)
    return trends[:25]

trends = get_twitter_trends("united-states")
for i, t in enumerate(trends, 1):
    print(f"{i:>2}. {t}")
```

> Install: `pip install beautifulsoup4 requests`

### Option C — getdaytrends.com

```python
def get_day_trends(country: str = "united+states") -> list[str]:
    url = f"https://getdaytrends.com/country/{country}/"
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
    soup = BeautifulSoup(r.text, "html.parser")
    return [a.get_text(strip=True) for a in soup.select("table.table a")][:25]
```

---

## 4. YouTube Trending

Requires a YouTube Data API v3 key (free tier: 10,000 units/day; this call costs ~1 unit).

```bash
YT_KEY="your_youtube_data_api_v3_key"
REGION="US"   # ISO 3166-1 alpha-2 country code

curl -s "https://www.googleapis.com/youtube/v3/videos" \
  -G \
  --data-urlencode "part=snippet,statistics" \
  --data-urlencode "chart=mostPopular" \
  --data-urlencode "regionCode=${REGION}" \
  --data-urlencode "maxResults=25" \
  --data-urlencode "key=${YT_KEY}" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
for item in d.get('items', []):
    s = item['snippet']
    stats = item.get('statistics', {})
    views = int(stats.get('viewCount', 0))
    print(f\"{views:>12,}  [{s['categoryId']}]  {s['title'][:70]}\")
"
```

```python
import requests

def youtube_trending(api_key: str, region: str = "US", max_results: int = 25) -> list[dict]:
    url = "https://www.googleapis.com/youtube/v3/videos"
    params = {
        "part": "snippet,statistics",
        "chart": "mostPopular",
        "regionCode": region,
        "maxResults": max_results,
        "key": api_key,
    }
    r = requests.get(url, params=params, timeout=10)
    r.raise_for_status()
    items = r.json().get("items", [])
    return [
        {
            "title": item["snippet"]["title"],
            "channel": item["snippet"]["channelTitle"],
            "category_id": item["snippet"]["categoryId"],
            "views": int(item["statistics"].get("viewCount", 0)),
            "tags": item["snippet"].get("tags", []),
            "description": item["snippet"]["description"][:200],
        }
        for item in items
    ]

YT_KEY = "your_youtube_data_api_v3_key"
videos = youtube_trending(YT_KEY, region="US")
for v in videos[:10]:
    print(f"{v['views']:>12,}  {v['title'][:70]}")
```

**Get a free API key:**
1. Go to https://console.cloud.google.com/
2. Create project → Enable "YouTube Data API v3"
3. Credentials → Create API Key

---

## 5. Brand Relevance Filter

Score trending topics against a niche keyword list. Useful for filtering which trends are worth riding for a specific brand (e.g., "ancient civilizations AI art").

```python
import re
from difflib import SequenceMatcher

# --- Configuration ---
BRAND_KEYWORDS = [
    "ancient", "civilization", "egypt", "roman", "greek", "mythology",
    "artifact", "ruin", "temple", "warrior", "pharaoh", "historical",
    "AI art", "digital art", "midjourney", "stable diffusion", "generative",
    "illustration", "fantasy art", "epic", "lore", "mystery",
]

def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", " ", text.lower())

def fuzzy_score(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()

def score_trend(topic: str, keywords: list[str], fuzzy_threshold: float = 0.7) -> float:
    """
    Return a relevance score 0.0–1.0 for a trend topic against the brand keyword list.
    - Exact word match: +0.4 per keyword hit (capped at 1.0)
    - Fuzzy match above threshold: +0.2 per hit
    """
    topic_norm = normalize(topic)
    topic_words = set(topic_norm.split())
    score = 0.0

    for kw in keywords:
        kw_norm = normalize(kw)
        kw_words = set(kw_norm.split())

        # Exact substring match
        if kw_norm in topic_norm:
            score += 0.4
            continue

        # Word overlap
        overlap = topic_words & kw_words
        if overlap:
            score += 0.3 * (len(overlap) / max(len(kw_words), 1))
            continue

        # Fuzzy match
        sim = fuzzy_score(topic_norm, kw_norm)
        if sim >= fuzzy_threshold:
            score += 0.2 * sim

    return min(score, 1.0)


def filter_relevant_trends(
    trends: list[str | dict],
    keywords: list[str] = BRAND_KEYWORDS,
    min_score: float = 0.2,
    title_key: str = "title",
) -> list[dict]:
    """
    Filter and rank a list of trend strings or dicts by brand relevance.

    Args:
        trends: list of str (topic names) or list of dict with a title field
        keywords: niche keyword list for scoring
        min_score: minimum score to include (0.0 = include all)
        title_key: dict key to use as the topic text (ignored for plain strings)

    Returns:
        Sorted list of dicts with 'topic' and 'score' keys (+ original fields if dict input).
    """
    results = []
    for item in trends:
        if isinstance(item, str):
            topic = item
            extra = {}
        else:
            topic = item.get(title_key, "")
            extra = item

        s = score_trend(topic, keywords)
        if s >= min_score:
            results.append({"topic": topic, "score": round(s, 3), **extra})

    results.sort(key=lambda x: x["score"], reverse=True)
    return results


# --- Example usage ---
if __name__ == "__main__":
    sample_trends = [
        "Ancient Egypt AI Art Goes Viral",
        "New iPhone Release Date Confirmed",
        "Roman Warriors Digital Illustration Trend",
        "Stock Market Crash 2026",
        "Midjourney v7 Ancient Mythology Prompts",
        "World Cup 2026 Scores",
        "Stable Diffusion Historical Ruins Tutorial",
        "Celebrity Drama Twitter",
    ]

    relevant = filter_relevant_trends(sample_trends, min_score=0.15)
    print(f"{'Score':>6}  Topic")
    print("-" * 60)
    for r in relevant:
        print(f"{r['score']:>6.3f}  {r['topic']}")
```

Sample output:
```
 Score  Topic
------------------------------------------------------------
 0.800  Ancient Egypt AI Art Goes Viral
 0.700  Midjourney v7 Ancient Mythology Prompts
 0.600  Roman Warriors Digital Illustration Trend
 0.600  Stable Diffusion Historical Ruins Tutorial
```

---

## Full Pipeline — Collect + Score + Report

```python
import time

def collect_all_trends(yt_api_key: str = None) -> list[str]:
    """Pull trends from all available sources."""
    all_topics = []

    # Reddit
    for sub in ["ArtificialIntelligence", "HistoryMemes", "DigitalArt", "worldnews", "technology"]:
        try:
            posts = reddit_hot_titles(sub, limit=20)
            all_topics += [p["title"] for p in posts]
            time.sleep(0.5)
        except Exception as e:
            print(f"[reddit/{sub}] {e}")

    # Twitter/X via trends24
    try:
        all_topics += get_twitter_trends("united-states")
    except Exception as e:
        print(f"[twitter] {e}")

    # YouTube
    if yt_api_key:
        try:
            vids = youtube_trending(yt_api_key, region="US", max_results=25)
            all_topics += [v["title"] for v in vids]
        except Exception as e:
            print(f"[youtube] {e}")

    # Google Trends (pytrends)
    try:
        from pytrends.request import TrendReq
        pt = TrendReq(hl='en-US', tz=360)
        df = pt.trending_searches(pn='united_states')
        all_topics += df[0].tolist()
    except Exception as e:
        print(f"[google_trends] {e}")

    return list(set(all_topics))  # deduplicate


def run_trend_report(brand_keywords: list[str], yt_api_key: str = None, top_n: int = 20):
    """Full pipeline: collect → score → print report."""
    print("Collecting trends from all sources...")
    topics = collect_all_trends(yt_api_key)
    print(f"Total topics collected: {len(topics)}")

    print("\nScoring for brand relevance...")
    ranked = filter_relevant_trends(topics, keywords=brand_keywords, min_score=0.1)

    print(f"\nTop {top_n} relevant trends:")
    print(f"{'Rank':>4}  {'Score':>6}  Topic")
    print("-" * 70)
    for i, r in enumerate(ranked[:top_n], 1):
        print(f"{i:>4}  {r['score']:>6.3f}  {r['topic'][:60]}")

    return ranked


# Run it
run_trend_report(
    brand_keywords=BRAND_KEYWORDS,
    yt_api_key="your_yt_key_or_None",
    top_n=20,
)
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| pytrends `ResponseError` | Google rate-limited your IP | Use `TrendReq(retries=3, backoff_factor=0.5)`, or switch to SerpAPI |
| Reddit 429 | Too many requests | Add `time.sleep(1)` between calls; max ~60 req/min |
| Nitter returns empty | Public instance down | Try a different Nitter instance from the wiki |
| YouTube 403 | API key invalid or quota exceeded | Check console.cloud.google.com → quotas |
| trends24.in scrape breaks | HTML structure changed | Fall back to getdaytrends.com or Nitter |

---

## Notes

- For automated daily runs, schedule via NanoClaw task scheduler (cron `0 6 * * *`)
- pytrends trending_searches works per country: `pn='vietnam'`, `pn='japan'`, etc.
- YouTube category IDs: 10=Music, 17=Sports, 20=Gaming, 24=Entertainment, 28=Science&Tech
- Combine Reddit score (upvotes) as a secondary weight signal when scoring dicts
- Cache trend results to disk (`/tmp/trend_cache.json`) to avoid re-fetching within same hour
