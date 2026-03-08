/**
 * PM2 ecosystem - production process manager
 * Kullanım: pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [{
    name: 'futbol-okulu',
    script: 'index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'development' },
    env_production: { NODE_ENV: 'production' }
  }]
};
