# AI Media Generator (Music, TTS, Video, Image)

Generate nhạc, giọng nói, video và ảnh thông qua Room Worker API.

---

## 🎵 QUY TRÌNH TẠO NHẠC (BẮT BUỘC)

**LUÔN LUÔN** soạn prompt theo cấu trúc dưới đây và gửi cho John duyệt TRƯỚC khi generate. Chỉ generate sau khi được xác nhận.

### Cấu trúc prompt chuẩn:
```
TITLE: <Tên bài hát>
GENRE: <thể loại cụ thể>
MOOD: <cảm xúc, không khí>
VOCALS: <loại giọng hát / narrator>
BPM: <nhịp độ>
KEY: <giọng nhạc>
DURATION: <thời lượng, ví dụ: 95s>
INSTRUMENTS: <nhạc cụ cụ thể, phân cách bằng dấu phẩy>
TEXTURE: <mô tả chất âm>
DESCRIPTION: <1-2 câu mô tả câu chuyện / cảm xúc bài nhạc>

LYRICS:
[Section name]
<Lời bài hát...>
```

### Ví dụ:
```
TITLE: Gate Before Dawn
GENRE: cinematic mythic orchestral narration
MOOD: ancient, mysterious, prophetic, awakening
VOCALS: deep male narrator + distant female choir pad
BPM: 72
KEY: D minor
DURATION: 95s
INSTRUMENTS: low strings drone, soft choir pad, ancient bell hits, slow taiko pulses, airy synth texture, distant brass swells
TEXTURE: spacious, reverent, dark-ambient orchestral, mythic atmosphere
DESCRIPTION: A solemn narrator reveals the origin of a forgotten celestial gate that existed before the first sunrise.

LYRICS:
[Intro – Whisper Choir]
Ah—ra—no—vel…

[Spoken Verse 1]
Before the first sunrise touched the sky...
```

### Sau khi John duyệt → Generate:

**Quy tắc chọn phương thức:**
- **≤120s**: Dùng Direct ACE-Step (nhanh, đồng bộ)
- **>120s (MV chuẩn 3-5 phút)**: Dùng Music Studio V2 async (không timeout, max 600s)

---

#### Phương thức 1 — Direct ACE-Step (≤120s)
```python
import subprocess, json, base64, struct

payload = {
    "prompt": "<GENRE> + <MOOD> + <INSTRUMENTS> + <BPM> BPM + <KEY> + professional master quality",
    "lyrics": "<FULL LYRICS>",
    "duration": <DURATION_SECONDS>,      # PHẢI có cả hai param
    "audio_duration": <DURATION_SECONDS>, # PHẢI có cả hai param
    "infer_step": 150,
    "guidance_scale": 8.0,
    "use_erg_tag": True,
    "use_erg_lyric": True,
    "use_erg_diffusion": True,
    "guidance_scale_lyric": 2.0,
    "guidance_scale_text": 1.0,
    "omega_scale": 10.0,
    "min_guidance_scale": 3.0
}
subprocess.run(["curl","-s","-X","POST","https://music-gen-container.attyzen.com/generate",
    "-H","Content-Type: application/json","-d",json.dumps(payload),
    "--max-time","300","-o","/tmp/music_response.json"])
```

#### Phương thức 2 — Music Studio V2 Async (>120s, max 600s) ✅ KHUYẾN NGHỊ cho MV
```python
import subprocess, json, time

# Bước 1: Login guest
r = subprocess.run(["curl","-s","-X","POST","https://room1.attyzen.com/api/auth/guest",
    "-H","Content-Type: application/json","-d",'{"username":"nanoclaw_agent"}'],
    capture_output=True, text=True)
token = json.loads(r.stdout)["data"]["sessionToken"]

# Bước 2: Submit job
payload = {
    "title": "<TITLE>",
    "prompt": "<GENRE> + <MOOD> + <INSTRUMENTS> + <BPM> BPM + <KEY> + master quality",
    "lyrics": "<FULL LYRICS>",
    "duration": <DURATION_SECONDS>,  # max 600
    "genre": "<GENRE>", "key": "<KEY>", "bpm": <BPM>,
    "infer_step": 150, "guidance_scale": 8.0,
    "guidance_scale_lyric": 2.0, "omega_scale": 10.0
}
r = subprocess.run(["curl","-s","-X","POST","https://room1.attyzen.com/api/music-studio-v2/jobs",
    "-H","Content-Type: application/json",
    "-H",f"Authorization: Bearer {token}",
    "-d",json.dumps(payload)], capture_output=True, text=True)
job_id = json.loads(r.stdout)["data"]["job_id"]

# Bước 3: Poll status
for _ in range(120):
    r = subprocess.run(["curl","-s",
        f"https://room1.attyzen.com/api/music-studio-v2/jobs/{job_id}",
        "-H",f"Authorization: Bearer {token}"], capture_output=True, text=True)
    job = json.loads(r.stdout)["data"]
    if job["status"] == "completed":
        track_id = job.get("track_id") or job.get("trackId")
        break
    time.sleep(10)

# Bước 4: Download audio
subprocess.run(["curl","-s",
    f"https://room1.attyzen.com/api/music-studio-v2/tracks/{track_id}/audio",
    "-H",f"Authorization: Bearer {token}",
    "-o","/tmp/music_output.mp3"])
# → Gửi /tmp/music_output.mp3 lên Telegram
```

⚠️ **Lưu ý quan trọng:**
- Dùng CẢ HAI `"duration"` VÀ `"audio_duration"` khi gọi trực tiếp ACE-Step
- Max duration: **600s** (~10 phút)
- MV chuẩn: 180–240s (3–4 phút)

---

## Endpoints

- **Room API (primary)**: `https://room1.attyzen.com` — dùng API Key hoặc guest session
- **Worker API (alt)**: `https://pi-chat-api.johnhojohn969.workers.dev`
- **Music (ACE-Step direct)**: `https://music-gen-container.attyzen.com` — không cần auth, max 600s
- **Facebook Manager**: `https://facebook-page-manager-container.attyzen.com`

## Authentication

### API Key (khuyến nghị — dùng cho mọi endpoint)
```bash
API_KEY="sk_room_<key>"  # John cung cấp
curl -s -H "X-API-Key: $API_KEY" https://room1.attyzen.com/api/ai-media/models
```

### Guest Session (tự tạo, không cần đăng ký)
```bash
SESSION=$(curl -s -X POST https://room1.attyzen.com/api/auth/guest \
  -H "Content-Type: application/json" -d '{"username":"nanoclaw_agent"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['sessionToken'])")
curl -s -H "Authorization: Bearer $SESSION" https://room1.attyzen.com/api/ai-media/models
```

## Check models available (không cần auth)

```bash
curl -s "https://room1.attyzen.com/api/ai-media/models" | python3 -m json.tool
# hoặc Worker API (mirror)
curl -s "https://pi-chat-api.johnhojohn969.workers.dev/api/ai-media/models" | python3 -m json.tool
```

## 🧙 AI Orchestration (tự động tạo prompts cho multi-modal)

```bash
AUTH="-H \"X-API-Key: $API_KEY\""

# Creative Wizard — 1 concept → prompts cho image + music + TTS + SFX
curl -s -X POST $AUTH -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/ai/wizard-prompt \
  -d '{"description": "ancient golden warrior awakens in sci-fi ruins", "type": "video"}' | python3 -m json.tool

# Music Prompt helper — description → ACE-Step optimized prompt
curl -s -X POST $AUTH -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/ai/music-prompt \
  -d '{"description": "cinematic sci-fi theme for golden warrior"}' | python3 -m json.tool

# Story/TTS script generator
curl -s -X POST $AUTH -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/ai/story-prompt \
  -d '{"description": "5-scene crypto trading drama, emotional journey"}' | python3 -m json.tool
```

## 🔊 Sound Effects (SFX)

```bash
curl -s -X POST $AUTH -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/sfx/generate \
  -d '{"prompt": "thunder crack then rain on metal", "duration": 5}' \
  -o /tmp/sfx.flac
```

## 🖼️ Image Enhance & Auto-tag

```bash
# Upscale/enhance image via Real-ESRGAN + CodeFormer
curl -s -X POST $AUTH -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/image/enhance \
  -d '{"image_url": "https://...", "scale": 2}' | python3 -m json.tool

# Auto-tag image content using AI
curl -s -X POST $AUTH -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/ai-media/image/tag \
  -d '{"image_url": "https://..."}' | python3 -m json.tool
```

## 🎵 Music Studio AI (lyrics, title, evaluate)

```bash
# Generate title + description + lyrics in 1 call
curl -s -X POST $AUTH -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/music-studio-v2/ai/generate-all \
  -d '{"description": "epic cinematic sci-fi D minor orchestral", "genre": "cinematic", "mood": "epic", "duration": 180}' \
  | python3 -m json.tool

# Evaluate track quality (after generating)
curl -s -X POST $AUTH -H "Content-Type: application/json" \
  https://room1.attyzen.com/api/music-studio-v2/ai/evaluate \
  -d '{"trackId": "TRACK_ID"}' | python3 -m json.tool
```

## 🎵 Music Generation (ACE-Step - MicroK8s)

**Endpoints:**
- Direct (no auth): `https://music-gen-container.attyzen.com/generate` → JSON `{audio_base64}`, max 600s
- Room API (auth): `https://room1.attyzen.com/api/ai-media/music/generate` → audio/mpeg binary, tốt cho ≤120s
- Music Studio V2 (auth, async): `https://room1.attyzen.com/api/music-studio-v2/jobs` → best cho >120s

**Decode audio từ Direct ACE-Step:**
```python
import json, base64, struct

d = json.load(open('/tmp/music_response.json'))
raw = base64.b64decode(d['audio_base64'])
# raw là IEEE float32 WAV — cần convert sang PCM16 để phát được
pos = 12
while pos < len(raw) - 8:
    cid = raw[pos:pos+4]; csz = struct.unpack_from('<I', raw, pos+4)[0]
    if cid == b'fmt ': fmt = raw[pos+8:pos+8+csz]
    elif cid == b'data':
        audio = raw[pos+8:pos+8+csz]
        _, ch, sr, _, _, bits = struct.unpack_from('<HHIIHH', fmt)
        dur = len(audio)/(sr*ch*(bits//8))
        n = len(audio)//4; floats = struct.unpack(f'<{n}f', audio)
        pcm = struct.pack(f'<{n}h', *[int(max(-1.,min(1.,f))*32767) for f in floats])
        wav = b'RIFF'+struct.pack('<I',36+len(pcm))+b'WAVE'
        wav += b'fmt '+struct.pack('<I',16)+struct.pack('<HHIIHH',1,ch,sr,sr*ch*2,ch*2,16)
        wav += b'data'+struct.pack('<I',len(pcm))+pcm
        open('/tmp/music.wav','wb').write(wav)
        print(f'Duration: {dur:.1f}s'); break
    pos += 8+csz+(csz%2)
```

**Music prompts hay dùng:**
- `"Upbeat Vietnamese pop, morning energy, motivating"`
- `"Relaxing lo-fi hip hop with soft piano and rain"`
- `"Epic orchestral cinematic with dramatic drums"`
- `"Smooth jazz saxophone with upright bass"`
- `"Electronic ambient with ethereal synth pads"`

**Deploy music-gen pod (nếu 503):**
```bash
kubectl apply -f ~/git/room/k8s/music-gen.yaml
```

## 🗣️ TTS - Text to Speech

```bash
# Tiếng Việt - FREE (HF)
curl -X POST \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  "https://pi-chat-api.johnhojohn969.workers.dev/api/ai-media/tts/generate" \
  -d '{"text": "Xin chào, đây là giọng nói AI", "model": "facebook/mms-tts-vie"}' \
  --output /tmp/speech.flac

# Tiếng Anh - FREE (Cloudflare)
curl -X POST \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  "https://pi-chat-api.johnhojohn969.workers.dev/api/ai-media/tts/generate" \
  -d '{"text": "Hello this is AI voice", "model": "@cf/myshell-ai/melotts"}' \
  --output /tmp/speech.flac
```

## 🖼️ Image Generation (FREE - FLUX via HF)

```bash
curl -X POST \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  "https://pi-chat-api.johnhojohn969.workers.dev/api/ai-image/generate" \
  -d '{
    "prompt": "A futuristic city at night, neon lights, cyberpunk style",
    "model": "black-forest-labs/FLUX.1-schnell",
    "width": 1024,
    "height": 1024,
    "steps": 4
  }' \
  --output /tmp/image.png
```

## 🎬 Video Generation

```bash
curl -X POST \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  "https://pi-chat-api.johnhojohn969.workers.dev/api/ai-media/video/generate" \
  -d '{"prompt": "A sunset over the ocean", "model": "Wan-AI/Wan2.1-T2V-14B"}' \
  --output /tmp/video.mp4
```

## 📤 Gửi file về Telegram (sau khi generate)

```bash
BOT_TOKEN="7986090023:AAFhg8IaukAMN5WGlyvCKgSlsYAcbdDiEP4"
CHAT_ID="1275624537"

# Gửi audio/nhạc
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendAudio" \
  -F "chat_id=${CHAT_ID}" \
  -F "audio=@/tmp/music.flac" \
  -F "title=AI Generated Music" \
  -F "performer=NanoClaw AI" \
  -F "caption=🎵 Nhạc AI sáng tác"

# Gửi ảnh
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto" \
  -F "chat_id=${CHAT_ID}" \
  -F "photo=@/tmp/image.png" \
  -F "caption=🖼️ Ảnh AI tạo"
```

## Status hiện tại

| Service | Status | URL |
|---------|--------|-----|
| Worker API | ✅ Live | pi-chat-api.johnhojohn969.workers.dev |
| Facebook Manager | ✅ Running | facebook-page-manager-container.attyzen.com |
| Music ACE-Step | ✅ Running (no auth needed) | music-gen-container.attyzen.com |
| Queue Worker | ✅ Running | queue-worker-container.attyzen.com |

## Notes
- ACE-Step tại `music-gen-container.attyzen.com/generate` — không cần auth, trả về JSON + audio_base64
- **Duration param**: phải dùng CẢ HAI `"duration"` VÀ `"audio_duration"` khi gọi direct endpoint
- **Max duration**: 600s (~10 phút). MV chuẩn: 180–240s
- **>120s**: dùng Music Studio V2 async để tránh timeout
- Room API base: `https://room1.attyzen.com` — guest login `/api/auth/guest`
- `duration_ms` trong response là thời gian xử lý API, KHÔNG phải độ dài audio
- Độ dài audio thực tế tính từ raw bytes: `len(audio_data) / (sr * ch * (bits//8))`
