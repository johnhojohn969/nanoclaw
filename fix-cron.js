const {execSync}=require('child_process');const fs=require('fs');
const line1='*/30 * * * * cd /home/john/workspace/okx-trading-bot/okx-export && OKX_STATE_DIR=./okx-state /home/john/.local/bin/node okx-trader.js >> ./logs/trader.log 2>&1';
const line2='15,45 * * * * cd /home/john/workspace/okx-trading-bot/okx-export && OKX_STATE_DIR=./okx-state /home/john/.local/bin/node okx-trader-lab.js >> ./logs/lab.log 2>&1';
const cron=line1+'
'+line2+'
';
fs.writeFileSync('/tmp/newcron.txt',cron);
execSync('crontab /tmp/newcron.txt');
console.log('Crontab updated!');

