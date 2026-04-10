# Cloudflare Bypass & Stealth Download Skill

## Mục đích
Download video/file từ các trang được bảo vệ bởi Cloudflare (Bot Management, JS Challenge) bằng cách sử dụng Chromium headless với chế độ stealth qua Chrome DevTools Protocol (CDP).

## Tại sao curl/requests thông thường bị block?
- **TLS fingerprint binding**: Cookie `cf_clearance` được Cloudflare bind với JA3 fingerprint của client tạo ra nó
- Nếu tạo cookie bằng Chrome nhưng dùng curl download → JA3 mismatch → HTTP 403
- **Giải pháp**: Phải download ngay trong Chromium process, không export cookie ra ngoài

## Chromium Stealth Setup

### Launch Chromium với anti-detection flags
```javascript
const chrome = spawn('/usr/bin/chromium', [
  '--headless',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--remote-debugging-port=9237',        // CDP port
  '--user-data-dir=/tmp/chrome-stealth',
  '--disable-blink-features=AutomationControlled',  // KEY: ẩn automation flag
]);
```

### Patch navigator.webdriver (CRITICAL)
```javascript
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  `
});
```

### Set realistic User-Agent
```javascript
await cdp('Network.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
});
```

## Download Flow (File/Video)

### Bước 1: Lấy CF clearance
```javascript
// Navigate đến homepage để Chromium tự xử lý CF JS Challenge
await cdp('Page.navigate', { url: 'https://domain.com/' });
await sleep(3000); // Chờ CF challenge giải quyết
```

### Bước 2: Intercept response với Fetch.enable
```javascript
await cdp('Fetch.enable', {
  patterns: [{
    urlPattern: '*cdn.domain.com/*.mp4*',  // pattern khớp với file cần download
    requestStage: 'Response'               // intercept ở Response stage (có data)
  }]
});
```

### Bước 3: Navigate đến URL chứa file
```javascript
await cdp('Page.navigate', { url: 'https://domain.com/video-page' });
// Đợi Fetch.requestPaused event với status 200
```

### Bước 4: Stream download từ intercepted response
```javascript
// Khi nhận Fetch.requestPaused với status 200/206:
// ⚠️ KHÔNG gọi Fetch.continueRequest — sẽ conflict với stream

const { stream: handle } = await cdp('Fetch.takeResponseBodyAsStream', {
  requestId: params.requestId
});

// Đọc stream theo chunks 128KB
const chunks = [];
while (true) {
  const { data, eof, base64Encoded } = await cdp('IO.read', {
    handle,
    size: 131072  // 128KB per read
  });

  const buf = base64Encoded
    ? Buffer.from(data, 'base64')
    : Buffer.from(data);
  chunks.push(buf);

  process.stdout.write(`  ${(Buffer.concat(chunks).length / 1e6).toFixed(1)}MB...`);

  if (eof) break;
}

await cdp('IO.close', { handle });
const fileBuffer = Buffer.concat(chunks);
fs.writeFileSync('/tmp/downloaded_file.mp4', fileBuffer);
```

## Template hoàn chỉnh (Node.js)

```javascript
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function stealthDownload(pageUrl, filePattern, outputPath) {
  // 1. Launch Chrome stealth
  const chrome = spawn('/usr/bin/chromium', [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--remote-debugging-port=9237', '--user-data-dir=/tmp/chrome-stealth2',
    '--disable-blink-features=AutomationControlled',
  ]);

  await new Promise(r => setTimeout(r, 1500));

  // 2. Connect CDP
  const wsUrl = await new Promise((resolve, reject) => {
    http.get('http://localhost:9237/json', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const targets = JSON.parse(d);
        resolve(targets[0]?.webSocketDebuggerUrl);
      });
    }).on('error', reject);
  });

  const WebSocket = require('ws');
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));

  let msgId = 1;
  const pending = new Map();
  const eventHandlers = new Map();

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    } else if (msg.method) {
      const handler = eventHandlers.get(msg.method);
      if (handler) handler(msg.params);
    }
  });

  const send = (method, params = {}) => new Promise((resolve) => {
    const id = msgId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const on = (event, handler) => eventHandlers.set(event, handler);

  // 3. Enable domains
  await send('Network.enable');
  await send('Page.enable');
  await send('Fetch.enable', {
    patterns: [{ urlPattern: filePattern, requestStage: 'Response' }]
  });

  // 4. Stealth patches
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'webdriver',{get:()=>undefined});window.chrome={runtime:{}};`
  });
  await send('Network.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });

  // 5. Get CF clearance on homepage
  const domain = new URL(pageUrl).origin;
  await send('Page.navigate', { url: domain + '/' });
  await new Promise(r => setTimeout(r, 3000));

  // 6. Setup intercept handler
  const fileData = await new Promise((resolve) => {
    on('Fetch.requestPaused', async (params) => {
      const status = params.responseStatusCode;
      if (status !== 200 && status !== 206) {
        await send('Fetch.continueRequest', { requestId: params.requestId });
        return;
      }

      console.log(`✅ Intercepted ${status}! Streaming...`);
      const { stream: handle } = await send('Fetch.takeResponseBodyAsStream', {
        requestId: params.requestId
      });

      const chunks = [];
      while (true) {
        const { data, eof, base64Encoded } = await send('IO.read', { handle, size: 131072 });
        chunks.push(base64Encoded ? Buffer.from(data, 'base64') : Buffer.from(data));
        process.stdout.write(`  ${(Buffer.concat(chunks).length / 1e6).toFixed(1)}MB...`);
        if (eof) break;
      }
      await send('IO.close', { handle });
      resolve(Buffer.concat(chunks));
    });

    // 7. Navigate to page with video
    send('Page.navigate', { url: pageUrl });
  });

  // 8. Save file
  fs.writeFileSync(outputPath, fileData);
  console.log(`\n✅ Saved: ${outputPath} (${fileData.length} bytes)`);

  chrome.kill();
  return outputPath;
}

// Usage example (Grok video)
stealthDownload(
  'https://grok.com/imagine/post/d981919b-9eb5-446c-ba7c-7bc0dd9caadb',
  '*imagine-public*share-videos*.mp4*',
  '/tmp/downloaded.mp4'
);
```

## Grok-specific Notes
- **Video URL pattern**: `*imagine-public*share-videos*.mp4*`
- **Page URL**: `https://grok.com/imagine/post/{POST_ID}`
- **CF warmup URL**: `https://imagine-public.x.ai/` (hoặc `https://grok.com/`)
- **Video size**: thường 3-30MB

## Khi nào dùng phương pháp này?
| Tình huống | Phương pháp |
|------------|-------------|
| Site có Cloudflare Bot Management | ✅ Stealth CDP |
| Site thông thường, không có CF | curl/wget/requests |
| File cần auth cookie | ✅ Stealth CDP |
| yt-dlp hỗ trợ site | yt-dlp (dễ hơn) |
| File từ CDN public không có CF | curl trực tiếp |

## Dependencies
- `/usr/bin/chromium` — Chromium 146+ (có sẵn trong Docker container)
- `ws` npm package: `cd /tmp && npm install ws`
- Node.js

## Troubleshooting
| Lỗi | Nguyên nhân | Fix |
|-----|-------------|-----|
| HTTP 403 dù có clearance cookie | TLS fingerprint mismatch khi dùng curl | Download trong Chromium process |
| Stream hanging | Gọi `continueRequest` sau `takeResponseBodyAsStream` | KHÔNG gọi continueRequest |
| `navigator.webdriver = true` | Không patch hoặc patch sau page load | Dùng `addScriptToEvaluateOnNewDocument` |
| CF JS Challenge không qua | Cần warm-up trước | Navigate homepage 3s trước khi vào target URL |
| `Fetch.requestPaused` không fire | Pattern không match | Dùng broad pattern `*domain*` |
