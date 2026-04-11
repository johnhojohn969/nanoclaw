#!/usr/bin/env node
/**
 * Host Exec — webhook server that lets container agents run commands on the host.
 * Listens on port 9988, authenticates via X-Exec-Token header.
 *
 * Edit ALLOWED to add new command patterns, then restart nanoclaw-host-exec.
 */

import http from 'http';
import { exec } from 'child_process';

const PORT = 9988;
const TOKEN = process.env.HOST_EXEC_TOKEN;

if (!TOKEN) {
  console.error('HOST_EXEC_TOKEN env var is required');
  process.exit(1);
}

// Allowed command patterns (regex). Add new patterns here.
const ALLOWED = [
  // systemctl user commands
  /^systemctl --user (start|stop|restart|status|enable|disable|daemon-reload|list-units)( \S+)?$/,
  // journalctl user logs
  /^journalctl --user -u \S+( -n \d+)?( --no-pager)?$/,
  // node scripts under home
  /^node \/home\/john\/.+\.js$/,
  // npm
  /^npm (start|run \S+)$/,
  // ls — list directory contents
  /^ls( -[a-zA-Z]+)?( .+)?$/,
  // cat — read files (under /home/john only)
  /^cat \/home\/john\/.+$/,
  // echo — write to files (under /home/john only)
  /^echo .+ >> \/home\/john\/.+$/,
  /^echo .+ > \/home\/john\/.+$/,
  // mkdir
  /^mkdir( -p)? \/home\/john\/.+$/,
  // crontab
  /^crontab -l$/,
  // tail — read end of files (under /home/john only)
  /^tail( -[a-zA-Z0-9]+)*( -n \d+)? \/home\/john\/.+$/,
];

function isAllowed(cmd) {
  return ALLOWED.some((pattern) => pattern.test(cmd.trim()));
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/exec') {
    res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const token = req.headers['x-exec-token'];
  if (token !== TOKEN) {
    res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    let cmd;
    try {
      ({ cmd } = JSON.parse(body));
    } catch {
      res.writeHead(400).end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    if (!cmd || typeof cmd !== 'string') {
      res.writeHead(400).end(JSON.stringify({ error: 'Missing cmd' }));
      return;
    }

    if (!isAllowed(cmd)) {
      console.log(`[DENIED] ${cmd}`);
      res.writeHead(403).end(JSON.stringify({ error: `Command not allowed: ${cmd}` }));
      return;
    }

    console.log(`[EXEC] ${cmd}`);
    exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: !err,
        exitCode: err ? err.code ?? 1 : 0,
        stdout: stdout || '',
        stderr: stderr || '',
      }));
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`host-exec listening on port ${PORT}`);
});
