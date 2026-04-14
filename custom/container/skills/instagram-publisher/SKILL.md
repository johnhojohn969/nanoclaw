# Instagram Publisher

Publish Reels and photos to an Instagram Business account via the Instagram Graph API.

> Note: Instagram Graph API only works with **Instagram Business** or **Creator** accounts that are connected to a **Facebook Page**. Personal accounts are not supported.

---

## Credentials Setup

```
IG_USER_ID=17841400000000000       # Instagram Business Account ID
PAGE_ID=1015889441613441           # Connected Facebook Page ID
PAGE_TOKEN=EAAVbn...               # Facebook Page Access Token (long-lived)
```

Required Page Token permissions:
- `instagram_basic`
- `instagram_content_publish`
- `pages_read_engagement`
- `pages_show_list`

Graph API base URL: `https://graph.facebook.com/v21.0`

---

## Step 0 — Get the Instagram Business Account ID

If you only have a Facebook Page ID and Page Token, retrieve the linked IG account ID once:

```bash
PAGE_ID="your_page_id"
PAGE_TOKEN="your_page_token"

curl -s "https://graph.facebook.com/v21.0/${PAGE_ID}" \
  -G \
  --data-urlencode "fields=instagram_business_account" \
  --data-urlencode "access_token=${PAGE_TOKEN}" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
ig = d.get('instagram_business_account', {})
print('IG_USER_ID =', ig.get('id'))
"
```

Store the returned ID as `IG_USER_ID` — all publish calls use this.

---

## Step 1 — Host the Media at a Public URL

The Instagram Graph API **does not accept file uploads directly**. The video or image must be at a publicly accessible HTTPS URL before you call the API.

### Option A — Room API Blob Storage (recommended)

```bash
API_KEY="sk_room_your_api_key"
LOCAL_FILE="/tmp/reel.mp4"
BLOB_PATH="instagram/$(date +%s)_reel.mp4"

# Upload to blob storage
curl -s -X PUT "https://room1.attyzen.com/api/blob/${BLOB_PATH}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: video/mp4" \
  --data-binary "@${LOCAL_FILE}"

# Construct public URL
PUBLIC_VIDEO_URL="https://room1.attyzen.com/api/blob/${BLOB_PATH}"
echo "Public URL: ${PUBLIC_VIDEO_URL}"
```

```python
import requests, time, os

def upload_to_blob(local_path: str, api_key: str, mime_type: str = "video/mp4") -> str:
    """Upload a local file to Room API blob storage and return the public URL."""
    blob_path = f"instagram/{int(time.time())}_{os.path.basename(local_path)}"
    url = f"https://room1.attyzen.com/api/blob/{blob_path}"
    with open(local_path, "rb") as f:
        r = requests.put(
            url,
            headers={"X-API-Key": api_key, "Content-Type": mime_type},
            data=f,
            timeout=120,
        )
    r.raise_for_status()
    return url  # this IS the public URL
```

### Option B — Temporary CDN via file.io

```bash
# Free, file deleted after first download — use only for one-off tests
PUBLIC_URL=$(curl -s -F "file=@/tmp/image.jpg" "https://file.io?expires=1d" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['link'])")
echo $PUBLIC_URL
```

> For production use Option A. file.io is single-use only.

---

## 2. Publish a Reel (Video)

Two-step process: create media container → publish.

### Step 2a — Create the Reel Container

```bash
IG_USER_ID="your_ig_user_id"
PAGE_TOKEN="your_page_token"
VIDEO_URL="https://room1.attyzen.com/api/blob/instagram/reel.mp4"
CAPTION="Ancient civilizations brought to life by AI art. #AIArt #AncientHistory #DigitalArt"

CONTAINER=$(curl -s -X POST \
  "https://graph.facebook.com/v21.0/${IG_USER_ID}/media" \
  -F "media_type=REELS" \
  -F "video_url=${VIDEO_URL}" \
  -F "caption=${CAPTION}" \
  -F "share_to_feed=true" \
  -F "access_token=${PAGE_TOKEN}")

CONTAINER_ID=$(echo $CONTAINER | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
echo "Container ID: ${CONTAINER_ID}"
```

```python
import requests

def create_reel_container(
    ig_user_id: str,
    page_token: str,
    video_url: str,
    caption: str,
    share_to_feed: bool = True,
) -> str:
    """Create an Instagram Reel media container. Returns container ID."""
    url = f"https://graph.facebook.com/v21.0/{ig_user_id}/media"
    data = {
        "media_type": "REELS",
        "video_url": video_url,
        "caption": caption,
        "share_to_feed": "true" if share_to_feed else "false",
        "access_token": page_token,
    }
    r = requests.post(url, data=data, timeout=30)
    r.raise_for_status()
    return r.json()["id"]
```

### Step 2b — Wait for Container to be Ready

Video processing takes 15–120 seconds. Poll the status before publishing.

```bash
# Check container status
curl -s "https://graph.facebook.com/v21.0/${CONTAINER_ID}" \
  -G \
  --data-urlencode "fields=status_code,status" \
  --data-urlencode "access_token=${PAGE_TOKEN}"
# status_code values: IN_PROGRESS | FINISHED | ERROR | EXPIRED
```

```python
import time

def wait_for_container(container_id: str, page_token: str, timeout: int = 180) -> bool:
    """Poll container status until FINISHED or timeout. Returns True if ready."""
    url = f"https://graph.facebook.com/v21.0/{container_id}"
    params = {"fields": "status_code,status", "access_token": page_token}
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        d = r.json()
        code = d.get("status_code")
        print(f"  Container status: {code}")
        if code == "FINISHED":
            return True
        if code == "ERROR":
            print(f"  Error details: {d.get('status')}")
            return False
        time.sleep(10)
    print("  Timed out waiting for container.")
    return False
```

### Step 2c — Publish the Reel

```bash
curl -s -X POST \
  "https://graph.facebook.com/v21.0/${IG_USER_ID}/media_publish" \
  -F "creation_id=${CONTAINER_ID}" \
  -F "access_token=${PAGE_TOKEN}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('Post ID:', d.get('id'))"
```

```python
def publish_container(ig_user_id: str, page_token: str, container_id: str) -> str:
    """Publish a ready media container. Returns the published post ID."""
    url = f"https://graph.facebook.com/v21.0/{ig_user_id}/media_publish"
    r = requests.post(url, data={"creation_id": container_id, "access_token": page_token}, timeout=30)
    r.raise_for_status()
    return r.json()["id"]
```

### Full Reel Publish — Combined

```python
def publish_reel(
    ig_user_id: str,
    page_token: str,
    video_url: str,
    caption: str,
) -> str:
    """End-to-end: create container → wait → publish. Returns post ID."""
    print("Creating Reel container...")
    container_id = create_reel_container(ig_user_id, page_token, video_url, caption)
    print(f"Container ID: {container_id}")

    print("Waiting for video processing...")
    ready = wait_for_container(container_id, page_token, timeout=180)
    if not ready:
        raise RuntimeError(f"Container {container_id} never reached FINISHED state.")

    print("Publishing...")
    post_id = publish_container(ig_user_id, page_token, container_id)
    print(f"Published! Post ID: {post_id}")
    return post_id


# Usage
POST_ID = publish_reel(
    ig_user_id=IG_USER_ID,
    page_token=PAGE_TOKEN,
    video_url="https://room1.attyzen.com/api/blob/instagram/myreel.mp4",
    caption="Ancient Egypt reimagined by AI. #AIArt #AncientEgypt",
)
```

---

## 3. Publish a Photo

Same 2-step pattern (create container → publish). No polling needed — images process immediately.

```bash
IMAGE_URL="https://room1.attyzen.com/api/blob/instagram/photo.jpg"
CAPTION="Golden pharaoh, AI-generated. #DigitalArt #AncientCivilizations"

# Step 1: Create container
CONTAINER=$(curl -s -X POST \
  "https://graph.facebook.com/v21.0/${IG_USER_ID}/media" \
  -F "image_url=${IMAGE_URL}" \
  -F "caption=${CAPTION}" \
  -F "access_token=${PAGE_TOKEN}")
CONTAINER_ID=$(echo $CONTAINER | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

# Step 2: Publish
curl -s -X POST \
  "https://graph.facebook.com/v21.0/${IG_USER_ID}/media_publish" \
  -F "creation_id=${CONTAINER_ID}" \
  -F "access_token=${PAGE_TOKEN}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('Post ID:', d.get('id'))"
```

```python
def publish_photo(
    ig_user_id: str,
    page_token: str,
    image_url: str,
    caption: str,
) -> str:
    """Publish a single photo to Instagram. Returns post ID."""
    # Create container
    r = requests.post(
        f"https://graph.facebook.com/v21.0/{ig_user_id}/media",
        data={"image_url": image_url, "caption": caption, "access_token": page_token},
        timeout=30,
    )
    r.raise_for_status()
    container_id = r.json()["id"]

    # Publish immediately (no wait needed for images)
    r2 = requests.post(
        f"https://graph.facebook.com/v21.0/{ig_user_id}/media_publish",
        data={"creation_id": container_id, "access_token": page_token},
        timeout=30,
    )
    r2.raise_for_status()
    post_id = r2.json()["id"]
    print(f"Photo published. Post ID: {post_id}")
    return post_id
```

---

## 4. Post Status Check

```bash
# Check any container or published post
curl -s "https://graph.facebook.com/v21.0/${CONTAINER_ID}" \
  -G \
  --data-urlencode "fields=status_code,status,id" \
  --data-urlencode "access_token=${PAGE_TOKEN}"
```

Status code meanings:

| `status_code` | Meaning |
|---|---|
| `IN_PROGRESS` | Video is still being processed |
| `FINISHED` | Ready to publish |
| `ERROR` | Processing failed — check `status` field for details |
| `EXPIRED` | Container not published within 24h — must recreate |
| `PUBLISHED` | Already published (returned for published containers) |

---

## 5. Check Publishing Rate Limit

Instagram allows **25 API-created posts per 24 hours** per Instagram account.

```bash
curl -s "https://graph.facebook.com/v21.0/${IG_USER_ID}/content_publishing_limit" \
  -G \
  --data-urlencode "fields=config,quota_usage" \
  --data-urlencode "access_token=${PAGE_TOKEN}" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
for item in d.get('data', []):
    cfg = item.get('config', {})
    usage = item.get('quota_usage', 0)
    limit = cfg.get('quota_total', 25)
    print(f'Used: {usage} / {limit}  (resets every {cfg.get(\"quota_duration\", 86400)}s)')
"
```

```python
def check_publish_quota(ig_user_id: str, page_token: str) -> dict:
    r = requests.get(
        f"https://graph.facebook.com/v21.0/{ig_user_id}/content_publishing_limit",
        params={"fields": "config,quota_usage", "access_token": page_token},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json().get("data", [{}])[0]
    return {
        "used": data.get("quota_usage", 0),
        "limit": data.get("config", {}).get("quota_total", 25),
    }

q = check_publish_quota(IG_USER_ID, PAGE_TOKEN)
print(f"Posts used today: {q['used']} / {q['limit']}")
```

---

## 6. Video Requirements for Reels

| Property | Requirement |
|---|---|
| Format | MP4 (H.264 video, AAC audio) |
| Aspect ratio | 9:16 (vertical, 1080x1920 recommended) |
| Duration | 3 seconds – 15 minutes |
| Frame rate | 23–60 fps |
| Max file size | 1 GB |
| Audio | Required (no silent reels via API) |
| URL accessibility | Must be a publicly accessible HTTPS URL — no auth, no redirects |
| URL availability | Must remain accessible until Instagram finishes processing (keep alive for at least 5 minutes after API call) |

**Photo requirements:**

| Property | Requirement |
|---|---|
| Format | JPEG or PNG |
| Max size | 8 MB |
| Aspect ratio | Between 4:5 and 1.91:1 |
| Min resolution | 320px on shortest side |
| Max resolution | 1440px on longest side |

---

## 7. Full End-to-End Pipeline Example

```python
import requests, time, os

# --- Config ---
IG_USER_ID = "your_ig_user_id"
PAGE_TOKEN  = "your_page_token"
API_KEY     = "sk_room_your_api_key"

def full_reel_pipeline(local_video_path: str, caption: str) -> str:
    """Upload video → host publicly → create container → publish. Returns post ID."""

    # 1. Upload to blob storage
    print(f"Uploading {local_video_path} to blob storage...")
    blob_path = f"instagram/{int(time.time())}_{os.path.basename(local_video_path)}"
    blob_url = f"https://room1.attyzen.com/api/blob/{blob_path}"
    with open(local_video_path, "rb") as f:
        r = requests.put(
            blob_url,
            headers={"X-API-Key": API_KEY, "Content-Type": "video/mp4"},
            data=f,
            timeout=120,
        )
    r.raise_for_status()
    print(f"Uploaded. Public URL: {blob_url}")

    # 2. Check quota before publishing
    q = check_publish_quota(IG_USER_ID, PAGE_TOKEN)
    if q["used"] >= q["limit"]:
        raise RuntimeError(f"Daily quota exhausted: {q['used']}/{q['limit']} posts used.")
    print(f"Quota OK: {q['used']}/{q['limit']} used.")

    # 3. Publish Reel
    post_id = publish_reel(IG_USER_ID, PAGE_TOKEN, blob_url, caption)
    print(f"Done! Instagram post ID: {post_id}")
    return post_id


# Run
full_reel_pipeline(
    local_video_path="/tmp/ancient_egypt_ai.mp4",
    caption="Ancient Egypt as you've never seen it — AI-generated art. #AIArt #AncientEgypt #DigitalHistory",
)
```

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `(#10)` Application does not have permission | Missing `instagram_content_publish` permission | Re-auth with correct scopes |
| `(#2207026)` Invalid image/video | Video URL not publicly accessible | Verify URL is reachable without auth; check no redirect |
| `(#9007)` Quota limit reached | 25 posts/24h exceeded | Wait for quota reset (check `content_publishing_limit`) |
| `status_code: ERROR` on container | Video format/codec issue | Re-encode: `ffmpeg -i in.mp4 -c:v libx264 -c:a aac out.mp4` |
| Container expires before publish | More than 24h passed | Recreate the container — EXPIRED ones cannot be published |
| `(#100)` Invalid parameter: `creation_id` | Container not yet FINISHED | Wait for `status_code=FINISHED` before calling `media_publish` |
| Page Token expired | Token rotated or revoked | Generate a new long-lived Page Token via Graph API Explorer |

**Re-encode video to Instagram-compatible format:**
```bash
ffmpeg -i input.mp4 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -crf 23 -preset fast \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  output_reels.mp4
```

---

## Notes

- Long-lived Page Access Tokens last ~60 days. Refresh before expiry via: `GET /oauth/access_token?grant_type=fb_exchange_token`
- `share_to_feed=true` on Reels ensures it also appears on the main feed grid, not just the Reels tab
- Scheduling is not natively supported in the IG API for Reels — use NanoClaw task scheduler (`schedule_task`) to queue timed publishes
- After publishing, get post insights: `GET /{post_id}/insights?metric=impressions,reach,plays`
- Graph API Explorer for testing: https://developers.facebook.com/tools/explorer/
