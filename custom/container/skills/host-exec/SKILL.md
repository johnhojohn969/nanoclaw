# Host Exec — Chạy lệnh trên Host Machine

Gọi webhook để thực thi lệnh trực tiếp trên máy host từ trong agent container.

## Endpoint
```
POST http://host.docker.internal:9988/exec
Header: X-Exec-Token: <HOST_EXEC_TOKEN from credentials.md>
Body: {"cmd": "<command>"}
```

## Quick Usage (bash)

```bash
TOKEN=$(grep "^HOST_EXEC_TOKEN=" /workspace/project/container/skills/credentials.md | cut -d= -f2-)
host_exec() {
    curl -s -X POST "http://host.docker.internal:9988/exec" \
        -H "Content-Type: application/json" \
        -H "X-Exec-Token: $TOKEN" \
        -d "{\"cmd\": \"$1\"}" | python3 -m json.tool
}

# Start Nova (nanoclaw-2)
host_exec "systemctl --user start nanoclaw-2"

# Restart
host_exec "systemctl --user restart nanoclaw-2"

# Check logs
host_exec "journalctl --user -u nanoclaw-2 -n 50 --no-pager"

# Reload services after editing .service file
host_exec "systemctl --user daemon-reload"
```

## Allowed Commands
- systemctl --user start|stop|restart|status|enable|disable <service>
- systemctl --user daemon-reload / list-units
- journalctl --user -u <service>
- node /home/john/git/<path>.js
- npm start|run <script>

## Add new commands
Edit ALLOWED array in /home/john/git/nanoclaw/host-exec/server.js then:
```bash
host_exec "systemctl --user restart nanoclaw-host-exec"
```
