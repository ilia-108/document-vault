const { copyFileSync } = require('node:fs');
copyFileSync('public/runtimeConfig.server.js', 'dist/runtimeConfig.js');
console.log('Server runtime configuration applied to dist/runtimeConfig.js.');
