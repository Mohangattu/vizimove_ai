module.exports = {
  apps: [
    {
      name: 'vizimove-backend',
      script: 'D:\\nodejs\\node.exe',
      args: 'node_modules\\tsx\\dist\\cli.mjs server.ts',
      cwd: 'D:\\viz 1',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
