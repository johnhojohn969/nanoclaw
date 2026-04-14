# Facebook Page Manager

Quản lý Facebook Pages qua Graph API và Room API proxy.

> ⚠️ **Thay đổi quan trọng từ tháng 6/2025:** Tất cả video trên Facebook tự động publish dưới dạng **Reels**. Không còn "video post" riêng. `/video/edit?v=...` = Reel.

---

## Credentials (SSMC page)

```
PAGE_ID=1015889441613441
PAGE_TOKEN=EAAVbnZAtShNYBRJWym5BADIwXRK2gRdIWDEy5N1T7d8C7BLYoNQNiiLP6FS36wv5nbQZCzBZAVbUYuM2N7rDZArMAxlZAnsGhnKezEeZBMj5JFw2SZBWHtPxoQiRezgiasfFvmM2T9Wa5859gEvShEAlqCfDc3Q1MnzlraASZCWth09HLgHXMJhSUn3x0Ez9ZCrKXJ7Ig
```

Permissions cần: `pages_manage_posts`, `pages_read_engagement`

---

## 3 Loại Post Chính — Graph API Direct

### 1. 🎬 Reel (Video) — `/{page_id}/video_reels`

Quy trình 2 bước. Từ 6/2025, tất cả video = Reel.

```bash
PAGE_TOKEN="..."
PAGE_ID="..."

# Bước 1: START — lấy upload_url + video_id
START=$(curl -s -X POST "https://graph.facebook.com/v21.0/${PAGE_ID}/video_reels" \
  -F "upload_phase=start" \
  -F "access_token=${PAGE_TOKEN}")
VIDEO_ID=$(echo $START | python3 -c "import json,sys; print(json.load(sys.stdin)['video_id'])")
UPLOAD_URL=$(echo $START | python3 -c "import json,sys; print(json.load(sys.stdin)['upload_url'])")

# Bước 1b: Upload file lên upload_url
FILE="/tmp/video.mp4"
FILE_SIZE=$(stat -c%s "$FILE")
curl -s -X POST "$UPLOAD_URL" \
  -H "Authorization: OAuth ${PAGE_TOKEN}" \
  -H "offset: 0" \
  -H "file_size: ${FILE_SIZE}" \
  --data-binary "@${FILE}"

# Bước 2: FINISH — publish
curl -s -X POST "https://graph.facebook.com/v21.0/${PAGE_ID}/video_reels" \
  -F "upload_phase=finish" \
  -F "video_id=${VIDEO_ID}" \
  -F "title=Tiêu đề bài viết" \
  -F "description=Caption bài viết" \
  -F "video_state=PUBLISHED" \
  -F "access_token=${PAGE_TOKEN}"
# → trả về {"success": true, "post_id": "..."}
```

**Draft (không publish ngay):** Thay `video_state=PUBLISHED` bằng `video_state=DRAFT`

**Check trạng thái xử lý video:**
```bash
curl -s "https://graph.facebook.com/v21.0/${VIDEO_ID}?fields=status&access_token=${PAGE_TOKEN}"
# Chờ copyright_check_status=complete trước khi FINISH
```

---

### 2. 🖼️ Single Photo — `/{page_id}/photos`

```bash
# Upload từ URL
curl -s -X POST "https://graph.facebook.com/v21.0/${PAGE_ID}/photos" \
  -F "url=https://example.com/photo.jpg" \
  -F "caption=Caption bài viết" \
  -F "published=true" \
  -F "access_token=${PAGE_TOKEN}"

# Upload từ file local
curl -s -X POST "https://graph.facebook.com/v21.0/${PAGE_ID}/photos" \
  -F "source=@/tmp/image.png" \
  -F "caption=Caption bài viết" \
  -F "published=true" \
  -F "access_token=${PAGE_TOKEN}"
```

---

### 3. 🖼️🖼️ Multi-Photo Post (pseudo-carousel) — 2 bước

Facebook không có organic carousel API kiểu Instagram. Multi-photo là cách thay thế.

```bash
# Bước 1: Upload từng ảnh với published=false (lấy ID)
PHOTO1=$(curl -s -X POST "https://graph.facebook.com/v21.0/${PAGE_ID}/photos" \
  -F "url=https://example.com/photo1.jpg" \
  -F "published=false" \
  -F "access_token=${PAGE_TOKEN}" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

PHOTO2=$(curl -s -X POST "https://graph.facebook.com/v21.0/${PAGE_ID}/photos" \
  -F "url=https://example.com/photo2.jpg" \
  -F "published=false" \
  -F "access_token=${PAGE_TOKEN}" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

# Bước 2: Tạo feed post gắn tất cả photo IDs
curl -s -X POST "https://graph.facebook.com/v21.0/${PAGE_ID}/feed" \
  -F "message=Caption bài viết" \
  -F "attached_media[0]={\"media_fbid\":\"${PHOTO1}\"}" \
  -F "attached_media[1]={\"media_fbid\":\"${PHOTO2}\"}" \
  -F "published=true" \
  -F "access_token=${PAGE_TOKEN}"
```

---

## Post Scheduling

```bash
# Schedule bài viết (Unix timestamp)
SCHEDULE_TIME=$(date -d "2026-04-01 09:00:00" +%s)

# Với feed post
curl -s -X POST "https://graph.facebook.com/v21.0/${PAGE_ID}/feed" \
  -F "message=Caption" \
  -F "scheduled_publish_time=${SCHEDULE_TIME}" \
  -F "published=false" \
  -F "access_token=${PAGE_TOKEN}"
```

---

## Publish / Unpublish Existing Post

```bash
# Publish một video/post đang là draft
curl -s -X POST "https://graph.facebook.com/v21.0/${POST_OR_VIDEO_ID}" \
  -F "published=true" \
  -F "access_token=${PAGE_TOKEN}"

# Unpublish (đưa về draft)
curl -s -X POST "https://graph.facebook.com/v21.0/${POST_OR_VIDEO_ID}" \
  -F "published=false" \
  -F "access_token=${PAGE_TOKEN}"
```

---

## Room API Facebook Endpoints (BFF proxy — nếu cần)

```bash
API_KEY="sk_room_00850fa7b2eb7f54ae7fbd613996ee4548621db8e50a2b5a4fe557d7cdb9afda"
BASE="https://room1.attyzen.com"

# Kiểm tra FB kết nối
curl -s -H "X-API-Key: $API_KEY" "$BASE/api/auth/facebook/status"

# Xem pages đã connect
curl -s -H "X-API-Key: $API_KEY" "$BASE/api/auth/facebook/my-pages"

# Tạo post qua Room API (cần FB OAuth connected)
curl -s -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  "$BASE/api/auth/facebook/pages/PAGE_ID/posts" \
  -d '{"message": "Caption", "published": false}'
```

> ⚠️ Room API Facebook cần FB OAuth connected. Dùng Graph API direct (trên) nếu có Page Token.

---

## Direct K8s Service (fallback)

```bash
API_SECRET="SELF_HOSTED_API_SECRET"
BASE="https://facebook-page-manager-container.attyzen.com"

curl https://facebook-page-manager-container.attyzen.com/health
curl -s -H "Authorization: Bearer $API_SECRET" "$BASE/pages" | jq .
curl -s -H "Authorization: Bearer $API_SECRET" \
  "$BASE/comments/PAGE_ID/all-comments?filter=unreplied" | jq .
curl -s -H "Authorization: Bearer $API_SECRET" \
  "$BASE/approval?status=pending" | jq .
curl -X POST -H "Authorization: Bearer $API_SECRET" \
  "$BASE/approval/ITEM_ID/approve"
curl -X POST -H "Authorization: Bearer $API_SECRET" \
  "$BASE/batch/generate-all"
```

---

## NanoClaw Pipeline Summary

| Content type | API | Endpoint |
|---|---|---|
| Video / Reel | Graph API direct | `/{page_id}/video_reels` (2-step) |
| Single image | Graph API direct | `/{page_id}/photos` |
| Gallery (multi-image) | Graph API direct | `/{page_id}/photos` × N → `/{page_id}/feed` |
| Text-only post | Graph API direct | `/{page_id}/feed` |
| AI-managed replies | K8s service | `facebook-page-manager-container.attyzen.com` |
