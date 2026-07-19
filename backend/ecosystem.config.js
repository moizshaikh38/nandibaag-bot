module.exports = {
  apps: [{
    name: 'nandibaag-backend',
    script: './src/server.js',
    instances: 1,
    max_memory_restart: '500M',
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s',
    error_file: './logs/error.log',
    out_file: './logs/combined.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
