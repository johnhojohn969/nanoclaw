# Self-Improve — Tự Đánh Giá & Nâng Cấp Skill

Kỹ năng tự nghiên cứu chuyên sâu, đánh giá chất lượng kết quả, và liên tục nâng cấp hệ thống skill lên cấp độ chuyên gia.

---

## 🧠 NGUYÊN TẮC CỐT LÕI

### Sau mỗi output quan trọng, tự hỏi:
1. **Chất lượng**: So với chuẩn chuyên nghiệp, output này ở đâu (1–10)?
2. **Thiếu gì**: Kỹ thuật nào mình chưa áp dụng mà đáng lẽ nên có?
3. **Tại sao**: Nguyên nhân sâu xa của kết quả tốt/chưa tốt?
4. **Cải thiện**: Lần sau làm gì khác đi?
5. **Skill update**: Kiến thức mới này đã được ghi vào SKILL.md chưa?

---

## 🔍 QUY TRÌNH NGHIÊN CỨU CHUYÊN SÂU

### Bước 1: Thu thập từ nguồn thực tế
```bash
# Luôn kiểm tra api/discover trước khi dùng bất kỳ service nào
curl -s "https://room1.attyzen.com/api/discover" | python3 -c "
import sys, json
d = json.load(sys.stdin)
# Tìm endpoint liên quan
print(json.dumps(d, indent=2, ensure_ascii=False)[:5000])
"

# Đọc source code thực tế trong git/room
find /workspace/extra/john/git/room/src -name "*.ts" | xargs grep -l "<keyword>"
```

### Bước 2: Test thực nghiệm
```python
# Không giả định — luôn test với giá trị nhỏ trước
# Ví dụ: test duration=10s trước khi gen 200s
# Ví dụ: test 1 image trước khi gen 5 images
```

### Bước 3: So sánh với chuẩn chuyên nghiệp
- Music: Compare với production standards (radio-ready, cinematic score)
- Video: Compare với professional short film techniques
- Code: Compare với clean architecture patterns

### Bước 4: Ghi lại và cập nhật skill
```python
# Sau mỗi phát hiện mới, UPDATE skill file ngay lập tức
# Không để kiến thức bị mất giữa các session
```

---

## 📊 TIÊU CHÍ ĐÁNH GIÁ THEO LĨNH VỰC

### 🎵 Music (ACE-Step)
| Tiêu chí | Cách đo |
|----------|---------|
| Duration accuracy | Actual audio length vs requested |
| Emotional match | Prompt mood → audio mood |
| Production quality | Clarity, dynamics, spatial feel |
| Lyrics sync | Vocal timing matches structure tags |

**Chuẩn chuyên gia:** infer_step=150, guidance_scale=8.0, cả hai param `duration` + `audio_duration`

### 🎬 Video Production
| Tiêu chí | Cách đo |
|----------|---------|
| Ken Burns | Ảnh có chuyển động không? |
| Audio ducking | Nhạc có tự duck khi narrator nói? |
| Emotional pacing | Volume automation đúng với cảm xúc? |
| Dramatic silence | Im lặng tại đúng khoảnh khắc? |
| Transitions | Crossfade smooth không? |

**Chuẩn chuyên gia:** Tất cả 5 tiêu chí trên phải được áp dụng

### 🖼️ Images
| Tiêu chí | Mức tốt |
|----------|---------|
| Resolution | 1024x576 (16:9) cho video |
| File size | >50KB = có detail đủ |
| Cinematic feel | Dramatic lighting, depth |

---

## 🔄 QUY TRÌNH TỰ NÂNG CẤP SKILL

```
1. Làm xong task → tự đánh giá (1–5 phút)
2. Phát hiện kỹ thuật mới hoặc fix bug → ghi vào SKILL.md ngay
3. Phát hiện pattern mới → thêm vào checklist
4. Fix lỗi quan trọng → thêm vào phần "⚠️ Common Pitfalls"
5. Tối ưu workflow → cập nhật code examples
```

### Format khi update SKILL.md:
```markdown
## ⚠️ Common Pitfalls (luôn có section này)
- **[Tên lỗi]**: Mô tả → Fix: giải pháp

## ✅ Verified Working (cập nhật khi test thành công)
- `param_name=value` → kết quả X
```

---

## 🔬 NGHIÊN CỨU CHUYÊN SÂU — CÁC NGUỒN

### Nguồn ưu tiên (theo thứ tự):
1. **api/discover** — source of truth cho toàn bộ Room API
2. **Source code** tại `/workspace/extra/john/git/room/src/`
3. **ffmpeg docs** — test thực nghiệm với các filter nhỏ
4. **ACE-Step behavior** — test với duration nhỏ trước
5. **Telegram Bot API** — test với message text trước file

### Khi gặp lỗi không hiểu:
```python
# 1. In full error/response
print(json.dumps(response, indent=2, ensure_ascii=False))

# 2. Test với payload tối giản
minimal_payload = {"required_field_only": "value"}

# 3. Check source code
grep -rn "error_message_keyword" /workspace/extra/john/git/room/src/

# 4. Test curl trực tiếp trước Python
```

---

## 🎯 SKILL GAPS HIỆN TẠI (cập nhật liên tục)

### Đã thành thạo:
- ✅ ACE-Step music generation (duration, quality params)
- ✅ Telegram Bot API (sendAudio, sendVideo, sendPhoto)
- ✅ Room API auth (guest token)
- ✅ ffmpeg Ken Burns effect
- ✅ ffmpeg audio ducking (sidechaincompress)
- ✅ Image generation (SDXL via Room API)
- ✅ TTS generation (Kokoro)

### Cần nghiên cứu thêm:
- 🔲 Music Studio V2 track_id download (chưa test thành công)
- 🔲 FLUX image quality vs SDXL comparison
- 🔲 ffmpeg xfade chaining cho n>3 scenes
- 🔲 Audio sync: music beat-matching với visual cuts
- 🔲 Video color grading với ffmpeg (warm/cold tones per scene)

---

## 📝 LOG CÁC PHÁT HIỆN QUAN TRỌNG

| Ngày | Phát hiện | Áp dụng |
|------|-----------|---------|
| 2026-03-30 | ACE-Step cần cả `duration` VÀ `audio_duration` | ai-media/SKILL.md |
| 2026-03-30 | Max duration = 600s (không phải 60s) | ai-media/SKILL.md |
| 2026-03-30 | Music Studio V2 track_id = None khi job done | Bug, chưa fix |
| 2026-03-30 | ffmpeg-static available via npm | video-production/SKILL.md |
| 2026-03-30 | sidechaincompress cho audio ducking | video-production/SKILL.md |
| 2026-03-30 | zoompan filter cho Ken Burns effect | video-production/SKILL.md |
