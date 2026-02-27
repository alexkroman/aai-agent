#!/bin/sh
# Write runtime config from environment variables
cat > /usr/share/nginx/html/config.js <<EOF
window.__PLATFORM_URL__ = "${PLATFORM_URL:-}";
EOF
exec nginx -g 'daemon off;'
