# Room API (room1.attyzen.com)

Tương tác với hệ thống **Room** — nền tảng chat, credits, AI media, music studio, storage, apps.

- **Base URL**: `https://room1.attyzen.com`
- **Discovery**: `https://room1.attyzen.com/api/discover` (cập nhật mỗi lần có endpoint mới)

## Tóm tắt API categories
| Category | Endpoints | Auth |
|----------|-----------|------|
| Auth | guest/pi login, refresh, me | none/bearer |
| Users | search, profile | bearer/apikey |
| Chat | list/create/messages/members | bearer/apikey |
| Credits | balance, history, deposit, transfer | bearer/apikey |
| Storage | blob CRUD theo namespace | bearer/apikey |
| Apps | catalog, install/uninstall | bearer/apikey |
| AI Image | models, generate, save, gallery | none/bearer |
| AI Media | music, tts, video, sfx, enhance, tag, gallery | none/bearer |
| AI Orchestration | wizard-prompt, music-prompt, story-prompt | bearer |
| **Music Studio v2** | **jobs, tracks, AI lyrics/title/describe, genres** | **bearer** |
| **Chatbot Music** | **parse, create, genres, structure templates** | **bearer** |
| Config/System | config, health, discover | none |

## Authentication

### Option 1 — Guest Login (không cần tài khoản)
```bash
SESSION=$(curl -s -X POST https://room1.attyzen.com/api/auth/guest \
  -H "Content-Type: application/json" \
  -d '{"username": "nanoclaw_agent"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['sessionToken'])")
echo "Session: $SESSION"
```

### Option 2 — API Key (service account) ⭐ RECOMMENDED
```bash
# Format: sk_room_<key>
# Dùng được cho tất cả api/discover endpoints
API_KEY="sk_room_00850fa7b2eb7f54ae7fbd613996ee4548621db8e50a2b5a4fe557d7cdb9afda"
curl -s -H "X-API-Key: $API_KEY" https://room1.attyzen.com/api/auth/me
```

### Option 3 — Pi Network Login
```bash
curl -s -X POST https://room1.attyzen.com/api/auth/pi \
  -H "Content-Type: application/json" \
  -d '{"accessToken": "<PI_ACCESS_TOKEN>"}' | python3 -m json.tool
```

### Dùng token trong mọi request
```bash
# Bearer token
curl -s -H "Authorization: Bearer $SESSION" https://room1.attyzen.com/api/auth/me | python3 -m json.tool

# Hoặc API Key
curl -s -H "X-API-Key: $API_KEY" https://room1.attyzen.com/api/auth/me | python3 -m json.tool
```

---

## 🔐 Auth

```bash
# Get current user info
curl -s -H "Authorization: Bearer $SESSION" https://room1.attyzen.com/api/auth/me | python3 -m json.tool

# Refresh session token
curl -s -X POST -H "Authorization: Bearer $SESSION" https://room1.attyzen.com/api/auth/refresh | python3 -m json.tool

# Logout
curl -s -X POST -H "Authorization: Bearer $SESSION" https://room1.attyzen.com/api/auth/logout
```

---

## 👥 Users

```bash
# Search users
curl -s -H "Authorization: Bearer $SESSION" \
  "https://room1.attyzen.com/api/users?q=john" | python3 -m json.tool

# Get user profile by ID
curl -s -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/profile/USER_ID | python3 -m json.tool

# Get profile by username
curl -s -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/profile/by-username/johnhojohn969 | python3 -m json.tool
```

---

## 💬 Chat

```bash
# List chats
curl -s -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/chats | python3 -m json.tool

# Create a chat
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/chats \
  -d '{"name": "My Chat", "type": "group"}' | python3 -m json.tool

# Get messages in a chat
curl -s -H "Authorization: Bearer $SESSION" \
  "https://room1.attyzen.com/api/chats/CHAT_ID/messages?limit=20" | python3 -m json.tool

# Send message
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/chats/CHAT_ID/messages \
  -d '{"content": "Hello from NanoClaw!"}' | python3 -m json.tool

# List members
curl -s -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/chats/CHAT_ID/members | python3 -m json.tool

# Add member
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/chats/CHAT_ID/members \
  -d '{"userId": "USER_ID"}' | python3 -m json.tool
```

---

## 💰 Credits

```bash
# Check credit balance
curl -s -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/credits/balance | python3 -m json.tool

# Transaction history
curl -s -H "Authorization: Bearer $SESSION" \
  "https://room1.attyzen.com/api/credits/transactions?limit=10" | python3 -m json.tool

# Deposit credits
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/credits/deposit \
  -d '{"amount": 100, "note": "Top up"}' | python3 -m json.tool

# Transfer credits to another user
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/credits/transfer \
  -d '{"toUserId": "USER_ID", "amount": 10, "note": "Payment"}' | python3 -m json.tool
```

---

## 📦 Storage (Blob)

```bash
# List blobs in namespace
curl -s -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/blob/my-namespace | python3 -m json.tool

# Upload file
curl -s -X PUT -H "Authorization: Bearer $SESSION" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/tmp/image.jpg \
  "https://room1.attyzen.com/api/blob/media/image.jpg"

# Download file
curl -s -H "Authorization: Bearer $SESSION" \
  "https://room1.attyzen.com/api/blob/media/image.jpg" -o /tmp/downloaded.jpg

# Delete blob
curl -s -X DELETE -H "Authorization: Bearer $SESSION" \
  "https://room1.attyzen.com/api/blob/media/image.jpg"
```

---

## 🎮 Apps

```bash
# List all apps in catalog
curl -s -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/apps/catalog | python3 -m json.tool

# Get app manifest
curl -s -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/apps/APP_ID/manifest | python3 -m json.tool

# Install app
curl -s -X POST -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/apps/APP_ID/install | python3 -m json.tool

# Uninstall app
curl -s -X DELETE -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/apps/APP_ID/install | python3 -m json.tool
```

---

## 🤖 AI Media

```bash
# Generate AI image
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-image/generate \
  -d '{"prompt": "A beautiful sunset over the ocean", "model": "black-forest-labs/FLUX.1-schnell"}' \
  -o /tmp/ai_image.png

# Text-to-Speech
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/tts/generate \
  -d '{"text": "Xin chào", "model": "facebook/mms-tts-vie"}' \
  -o /tmp/speech.flac

# Sound effects
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/sfx/generate \
  -d '{"prompt": "thunder and rain", "duration": 5}' \
  -o /tmp/sfx.flac

# Image enhance (upscale/improve)
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/image/enhance \
  -d '{"image_url": "https://...", "scale": 2}' | python3 -m json.tool

# Image tag (auto-tagging)
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/image/tag \
  -d '{"image_url": "https://..."}' | python3 -m json.tool

# AI Prompt helpers (no generation, just prompt writing)
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/ai/music-prompt \
  -d '{"description": "cinematic Vietnamese pop morning song"}' | python3 -m json.tool

curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/ai/wizard-prompt \
  -d '{"description": "fantasy forest at dawn", "type": "image"}' | python3 -m json.tool
```

---

## 🎵 Music Studio v2 (ACE-Step v1.5 — GPU, max 600s)

**Workflow: Submit job → Poll status → Download audio**

```bash
# Check service status (must be "online: true")
curl -s -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/music-studio-v2/service/status | python3 -m json.tool

# Get AI-generated lyrics
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/music-studio-v2/ai/lyrics \
  -d '{"prompt": "Vietnamese pop morning energy", "genre": "pop", "mood": "happy"}' | python3 -m json.tool

# Generate AI title
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/music-studio-v2/ai/title \
  -d '{"prompt": "upbeat Vietnamese morning pop", "genre": "pop"}' | python3 -m json.tool

# Submit generation job
JOB=$(curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/music-studio-v2/jobs \
  -d '{
    "title": "Mặt Trời Sáng",
    "prompt": "Vietnamese pop song, upbeat cheerful morning, piano acoustic guitar, male vocal, 120 BPM",
    "lyrics": "[Verse 1]\nMặt trời sáng lên, ngày mới bắt đầu\n\n[Chorus]\nChúng ta hãy bắt đầu, một ngày mới",
    "duration": 90,
    "genre": "pop",
    "mood": "happy"
  }')
JOB_ID=$(echo "$JOB" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['job_id'])")
echo "Job ID: $JOB_ID"

# Poll until completed (usually 5-10s)
while true; do
  RESULT=$(curl -s -H "Authorization: Bearer $SESSION" \
    "https://room1.attyzen.com/api/music-studio-v2/jobs/${JOB_ID}")
  STATUS=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])")
  echo "Status: $STATUS"
  [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] && break
  sleep 3
done

# Get audio via ACE-Step direct (job result has file_id, use ACE-Step to fetch)
FILE_ID=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['result']['file_id'])")
# Note: audio file is at music-gen-container.attyzen.com/files/$FILE_ID
# OR regenerate using direct ACE-Step endpoint (returns audio_base64 in JSON)

# List all jobs
curl -s -H "Authorization: Bearer $SESSION" \
  "https://room1.attyzen.com/api/music-studio-v2/jobs?limit=10" | python3 -m json.tool

# Get tracks
curl -s -H "Authorization: Bearer $SESSION" \
  "https://room1.attyzen.com/api/music-studio-v2/tracks" | python3 -m json.tool
```

### Song structure templates
```bash
# Available: pop-standard, rock, lo-fi-ambient, hip-hop, edm, cinematic, ballad
curl -s -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/chatbot/music/structure/cinematic | python3 -m json.tool
```

---

## 🤖 Chatbot Music (Conversational song creation)

```bash
# Parse natural language into song params
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/chatbot/music/parse \
  -d '{"message": "tạo bài nhạc pop Việt Nam vui tươi buổi sáng, 90 giây"}' | python3 -m json.tool

# Create song from parsed params (submit to queue)
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/chatbot/music/create \
  -d '{
    "title": "Mặt Trời Sáng",
    "prompt": "Vietnamese pop morning",
    "lyrics": "...",
    "genre": "pop",
    "mood": "happy",
    "duration": 90
  }' | python3 -m json.tool

# Validate lyrics structure
curl -s -X POST -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/chatbot/music/validate-lyrics \
  -d '{"lyrics": "[Verse 1]\nLời bài hát..."}' | python3 -m json.tool

# Get tickets (pending generation requests)
curl -s -H "Authorization: Bearer $SESSION" \
  https://room1.attyzen.com/api/chatbot/music/tickets | python3 -m json.tool
```

---

## 🎵 Recommended: Direct ACE-Step (fastest, returns audio_base64)

```bash
# Luôn available, không cần session, trả về JSON có audio_base64
curl -s -X POST https://music-gen-container.attyzen.com/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Vietnamese pop morning, cheerful, piano guitar, 110 BPM",
    "lyrics": "[Verse 1]\nMặt trời sáng lên...\n[Chorus]\nBước đi cùng nhau...",
    "audio_duration": 90,
    "infer_step": 100,
    "guidance_scale": 7.0,
    "use_erg_tag": true,
    "use_erg_lyric": true,
    "guidance_scale_lyric": 1.5
  }' -o /tmp/response.json --max-time 180

python3 -c "
import json, base64, struct
d = json.load(open('/tmp/response.json'))
raw = base64.b64decode(d['audio_base64'])
# Convert float32 WAV → PCM16 WAV (see ai-media skill for full converter)
print(f'Audio: {len(raw)/(48000*2*4):.0f}s at 48kHz stereo')
"
```

---

## ⚙️ System

```bash
# Health check (no auth)
curl -s https://room1.attyzen.com/api/health | python3 -m json.tool

# Public config (no auth)
curl -s https://room1.attyzen.com/api/config | python3 -m json.tool

# Full API discovery (no auth)
curl -s https://room1.attyzen.com/api/discover | python3 -m json.tool
```

---

## Quick Start — Guest Session

```bash
# 1. Lấy session token (guest)
SESSION=$(curl -s -X POST https://room1.attyzen.com/api/auth/guest \
  -H "Content-Type: application/json" \
  -d '{"username": "nanoclaw_agent"}' | \
  python3 -c "import json,sys; print(json.load(sys.stdin)['data']['sessionToken'])")

# 2. Kiểm tra user
curl -s -H "Authorization: Bearer $SESSION" https://room1.attyzen.com/api/auth/me | python3 -m json.tool

# 3. Xem balance
curl -s -H "Authorization: Bearer $SESSION" https://room1.attyzen.com/api/credits/balance | python3 -m json.tool
```

## Notes
- Base URL: `https://room1.attyzen.com`
- Guest token tự động tạo, không cần đăng ký
- API Key format: `sk_room_<key>` — hỏi John để lấy service account key
- Pi Network auth cần `accessToken` từ Pi Network SDK
- Tất cả response đều có format: `{"success": true/false, "data": {...}}`
