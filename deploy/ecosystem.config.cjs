/**
 * PM2 process file for IndiraGPT backend.
 *
 * Usage (on EC2, from repo root):
 *   cd GPT-Indira-New-main/backend && npm run install:all && npm run build
 *   pm2 start ../deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup
 */
const path = require('path');

const backendDir = path.resolve(__dirname, '../backend');

module.exports = {
  apps: [
    {
      name: 'finance-gpt-api',
      cwd: backendDir,
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: '9005',
      },
      error_file: path.join(backendDir, 'logs/pm2-error.log'),
      out_file: path.join(backendDir, 'logs/pm2-out.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
