# Video Production — Cinematic Storytelling

Kỹ năng dựng video chuyên nghiệp: slide image + TTS + music → emotional short film.

**Tools:** ffmpeg-static (npm), Room API (TTS + Image), ACE-Step (Music)

---

## 🎬 NGUYÊN TẮC CƠ BẢN

### Cấu trúc cảm xúc (3-Act)
```
Act 1 — Setup (30%):     Ai? Tại sao? Bối cảnh → nhạc nhẹ, intimate
Act 2A — Rising (25%):   Mọi thứ tốt lên → nhạc build, năng lượng tăng
Act 2B — Crisis (25%):   Đỉnh điểm xung đột → nhạc căng thẳng, giảm
Act 3 — Resolution (20%): Bài học, cảm xúc kết → nhạc resolve, ấm
```

### Quy tắc âm thanh chuyên nghiệp
| Thời điểm | Nhạc nền | Tại sao |
|-----------|----------|---------|
| Narrator đang nói | 10–18% volume | Ngôn từ là trọng tâm |
| Giữa các câu (0.5–1s) | Tự swell lên 25–35% | Cảm xúc thấm vào |
| Cảnh hành động/cao trào | 35–50% | Năng lượng tổng hợp |
| Cảnh buồn/sâu lắng | 5–10% | Sự cô đơn, trống rỗng |
| **Khoảnh khắc sốc** | **0% (im lặng hoàn toàn)** | **Im lặng = cú đấm mạnh nhất** |
| Kết thúc resolve | 20–30%, fade out | Cảm giác hoàn chỉnh |

---

## 🛠️ KỸ THUẬT FFMPEG

### Setup
```python
import subprocess, os, re

# Install once per session
os.system("cd /tmp && npm install ffmpeg-static --quiet 2>/dev/null")
FFMPEG = "/tmp/node_modules/ffmpeg-static/ffmpeg"

def get_dur(path):
    r = subprocess.run([FFMPEG, "-i", path, "-f", "null", "-"],
        capture_output=True, text=True, timeout=15)
    m = re.search(r'Duration: (\d+):(\d+):(\d+\.?\d*)', r.stderr)
    return int(m.group(1))*3600 + int(m.group(2))*60 + float(m.group(3)) if m else 10.0
```

### 1. Ken Burns Effect (slow zoom/pan trên ảnh tĩnh)
```python
def ken_burns(img_path, dur, out_path, direction='zoom_in'):
    """Tạo video từ ảnh tĩnh với hiệu ứng slow zoom/pan"""
    frames = int(dur * 24)
    spd = 0.00035  # tốc độ zoom (nhỏ = chậm hơn)

    if direction == 'zoom_in':
        vf = f"zoompan=z='min(zoom+{spd},1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1024x576:fps=24"
    elif direction == 'zoom_out':
        vf = f"zoompan=z='if(eq(on,1),1.12,max(zoom-{spd},1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1024x576:fps=24"
    elif direction == 'pan_right':
        vf = f"zoompan=z='1.08':x='max(0,min(iw*0.08*(on/{frames}),iw*(1-1/zoom)))':y='ih/2-(ih/zoom/2)':d={frames}:s=1024x576:fps=24"

    cmd = [FFMPEG, "-y",
        "-loop", "1", "-framerate", "24", "-i", img_path,
        "-t", str(dur),
        "-vf", f"{vf},format=yuv420p",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22", out_path]
    subprocess.run(cmd, capture_output=True, timeout=120)
```

### 2. Audio Ducking (nhạc tự giảm khi narrator nói)
```python
def mix_with_ducking(video_path, narr_path, music_path, out_path,
                     music_start=0.0, base_music_vol=0.25):
    """
    sidechaincompress: khi narrator lên tiếng, nhạc tự động duck xuống
    - threshold=0.015: mức nhạy với giọng nói
    - ratio=6: giảm 6x khi active
    - attack=80ms: phản ứng nhanh khi narrator bắt đầu nói
    - release=1500ms: nhạc tăng dần sau khi narrator ngừng (tạo swell tự nhiên)
    """
    dur = get_dur(narr_path) + 0.5
    cmd = [FFMPEG, "-y",
        "-i", video_path,
        "-i", narr_path,
        "-ss", str(music_start), "-stream_loop", "-1", "-i", music_path,
        "-filter_complex",
            f"[2:a]volume={base_music_vol}[bg_raw];"
            f"[bg_raw][1:a]sidechaincompress=threshold=0.015:ratio=6:attack=80:release=1500[bg_duck];"
            f"[1:a][bg_duck]amix=inputs=2:duration=first[audio]",
        "-map", "0:v", "-map", "[audio]",
        "-t", str(dur),
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", out_path]
    subprocess.run(cmd, capture_output=True, timeout=120)
    return dur
```

### 3. Dramatic Silence (im lặng tại khoảnh khắc sốc)
```python
def add_silence_gap(narr1_path, narr2_path, silence_dur, out_path):
    """Ghép 2 narration với khoảng im lặng hoàn toàn ở giữa"""
    # Tạo silent audio
    silence_path = out_path.replace('.mp3', '_silence.wav')
    subprocess.run([FFMPEG, "-y",
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono",
        "-t", str(silence_dur), silence_path],
        capture_output=True, timeout=15)
    # Ghép: narr1 + silence + narr2
    lst = out_path + "_list.txt"
    with open(lst, "w") as f:
        f.write(f"file '{narr1_path}'\nfile '{silence_path}'\nfile '{narr2_path}'\n")
    subprocess.run([FFMPEG, "-y", "-f", "concat", "-safe", "0",
        "-i", lst, "-c:a", "aac", out_path],
        capture_output=True, timeout=30)
```

### 4. Crossfade Transitions (xfade giữa các cảnh)
```python
def concat_with_xfade(scene_paths, scene_durs, out_path, fade_dur=0.5):
    """Ghép video với crossfade transition giữa các cảnh"""
    if len(scene_paths) == 1:
        subprocess.run([FFMPEG, "-y", "-i", scene_paths[0], "-c", "copy", out_path],
            capture_output=True)
        return

    # Build complex filter graph
    inputs = []
    for p in scene_paths:
        inputs += ["-i", p]

    n = len(scene_paths)
    fv = []  # video filter chain
    fa = []  # audio filter chain

    # Label all inputs
    vlinks = [f"[{i}:v]" for i in range(n)]
    alinks = [f"[{i}:a]" for i in range(n)]

    # Chain xfade for video, acrossfade for audio
    offset = 0.0
    for i in range(n - 1):
        offset += scene_durs[i] - fade_dur
        v_in = f"[v{i}]" if i > 0 else vlinks[i]
        v_out = f"[v{i+1}]" if i < n-2 else "[vout]"
        a_in = f"[a{i}]" if i > 0 else alinks[i]
        a_out = f"[a{i+1}]" if i < n-2 else "[aout]"

        next_v = vlinks[i+1] if i == 0 else f"[v{i+1}_raw]"
        next_a = alinks[i+1] if i == 0 else f"[a{i+1}_raw]"

        fv.append(f"{v_in}{vlinks[i+1]}xfade=transition=fade:duration={fade_dur}:offset={offset:.3f}{v_out if i==n-2 else f'[v{i+1}]'}")
        fa.append(f"{a_in}{alinks[i+1]}acrossfade=d={fade_dur}:c1=tri:c2=tri{a_out if i==n-2 else f'[a{i+1}]'}")
        offset = 0  # reset (offsets are relative in chain)

    filter_str = ";".join(fv + fa)
    cmd = [FFMPEG, "-y"] + inputs + [
        "-filter_complex", filter_str,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-c:a", "aac", "-b:a", "192k", out_path]
    subprocess.run(cmd, capture_output=True, timeout=300)
```

### 5. Simple Concat (fallback khi xfade quá phức tạp)
```python
def concat_simple(scene_paths, out_path):
    lst = "/tmp/concat_list.txt"
    with open(lst, "w") as f:
        for p in scene_paths: f.write(f"file '{p}'\n")
    subprocess.run([FFMPEG, "-y", "-f", "concat", "-safe", "0",
        "-i", lst, "-c", "copy", out_path],
        capture_output=True, timeout=120)
```

### 6. Fade in/out cho toàn video
```python
def add_fades(in_path, out_path, total_dur, fade_dur=1.0):
    cmd = [FFMPEG, "-y", "-i", in_path,
        "-vf", f"fade=t=in:st=0:d={fade_dur},fade=t=out:st={total_dur-fade_dur}:d={fade_dur}",
        "-af", f"afade=t=in:st=0:d={fade_dur},afade=t=out:st={total_dur-fade_dur}:d={fade_dur}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-c:a", "aac", "-b:a", "192k", out_path]
    subprocess.run(cmd, capture_output=True, timeout=120)
```

---

## 🎬 FULL PRODUCTION PIPELINE

```python
# Cấu trúc một video hoàn chỉnh:

SCENES = [
    {
        "name": "scene1",
        "img_prompt": "...",          # prompt cho SDXL/FLUX
        "narr_text": "...",           # lời kể chuyện
        "voice": "bm_george",         # giọng TTS
        "music_vol": 0.15,            # volume nhạc nền (0.0–1.0)
        "zoom_dir": "zoom_in",        # Ken Burns direction
        "pause_intro": 1.5,           # giây nhạc trước narrator
        "split_silence": None,        # (dur_s) nếu cần im lặng giữa scene
    },
    # ...
]

# Workflow:
# 1. gen_image()     → scene1.png
# 2. gen_tts()       → narr1.mp3 [+ silence split nếu cần]
# 3. ken_burns()     → scene1_anim.mp4  (video only, no audio)
# 4. mix_with_ducking() → scene1_final.mp4 (video + ducked audio)
# 5. concat_simple() / concat_with_xfade() → raw_output.mp4
# 6. add_fades()     → final.mp4
# 7. sendVideo to Telegram
```

---

## 🗣️ TTS Voices (Kokoro)
| Voice | Language | Style | Dùng cho |
|-------|----------|-------|---------|
| `bm_george` | EN | British male, gravitas | Documentary, epic narrator |
| `am_adam` | EN | American male, warm | Personal story, relatable |
| `af_heart` | EN | Female, emotional | Intimate, feminine story |
| `bf_emma` | EN | British female, clear | Professional narration |

Speed: 0.80–0.88 cho storytelling (chậm = cảm xúc hơn)

---

## 📐 Nguyên tắc ảnh (Image Prompts)
- Luôn thêm: `cinematic, dramatic lighting, 8k illustration, emotional`
- Scene buồn: `deep blue, cold tones, shadows, isolated`
- Scene vui/hy vọng: `warm golden light, sunrise, soft glow`
- Scene hành động: `dynamic composition, motion blur, high contrast`
- Tỷ lệ video: `width=1024, height=576` (16:9)

---

## ✅ Checklist trước khi render
- [ ] Mỗi cảnh có đủ: image + narration + music section?
- [ ] Scene 4 (hoặc cảnh cảm xúc nhất) có im lặng dramatique không?
- [ ] Music volume automation đúng theo cảm xúc từng cảnh?
- [ ] Có Ken Burns effect không (không nên để ảnh hoàn toàn tĩnh)?
- [ ] Có fade in/out ở đầu và cuối không?
- [ ] File size < 50MB (Telegram limit)?

---

## ⚠️ COMMON PITFALLS & FIXES

### 🔊 Audio quá nhỏ (mean < -20dB)
**Nguyên nhân:** `amix` mặc định normalize làm giảm volume ~50%  
**Fix:** Thêm `normalize=0` vào amix + boost narration + loudnorm cuối

```python
# ĐÚNG — filter audio đủ to:
"-filter_complex",
    f"[1:a]volume=3.0[narr];"                          # boost narration 3x
    f"[2:a]volume={music_vol}[bg_raw];"
    "[bg_raw][narr]sidechaincompress=threshold=0.015:ratio=6:attack=80:release=1500[bg_duck];"
    "[narr][bg_duck]amix=inputs=2:duration=first:normalize=0[audio]",  # normalize=0 !

# Sau khi concat + fade, áp loudnorm để đạt chuẩn -14 LUFS:
"-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
```

### 🗣️ TTS đọc đều (monotone)
**Nguyên nhân:** Một giọng, một tốc độ → thiếu cảm xúc  
**Fix:**
1. Dùng nhiều giọng theo cảm xúc cảnh:
   - `bm_george` (British, gravitas) → cảnh sử thi, epic
   - `af_heart` (female, ấm) → cảnh buồn, thân mật  
   - `am_adam` (American, gần gũi) → cảnh cá nhân, relatable
2. Chia narration thành CÂU NGẮN + thêm silence giữa các câu quan trọng
3. Speed: 0.78 cho khoảnh khắc nặng nề, 0.92 cho năng lượng cao
4. Thêm `...` và newline để TTS tạo pause tự nhiên

```python
# Tách câu quan trọng thành file riêng rồi ghép với silence:
gen_tts(token, "Sentence one.", voice, path_a, speed=0.80)
add_silence(0.8, path_silence)   # 0.8s pause
gen_tts(token, "Sentence two.", voice, path_b, speed=0.82)
concat_audio([path_a, path_silence, path_b], path_final)
```

### 📐 Chuẩn volume chuyên nghiệp
| Chuẩn | Target |
|-------|--------|
| Streaming (YouTube/Facebook) | -14 LUFS |
| Broadcast TV | -23 LUFS |
| Peak ceiling | -1.5 dBTP |
| Narration trong mix | Dominant, clear |
| Music khi narrator nói | -20 đến -25 dB dưới narration |
