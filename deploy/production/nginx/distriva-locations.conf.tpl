# Dimuat di dalam blok server (dibuat bin/render-nginx.sh).
server_tokens off;
client_max_body_size @UPLOAD_MAX@;
client_body_timeout 120s;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "same-origin" always;
@HSTS@

root @WEB_ROOT@;
index index.html;

# Pemeriksaan kesehatan Laravel
location = /up {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME @BACKEND_PUBLIC@/index.php;
    fastcgi_param SCRIPT_NAME /index.php;
    fastcgi_pass unix:@FPM_SOCK@;
    access_log off;
}

# API Laravel. Batas laju per IP sebagai perisai pertama (batas aplikasi lebih ketat dan tetap berlaku).
location /api/ {
    limit_req zone=distriva_api burst=60 nodelay;
    limit_req_status 429;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME @BACKEND_PUBLIC@/index.php;
    fastcgi_param SCRIPT_NAME /index.php;
    fastcgi_param HTTP_PROXY "";
    fastcgi_read_timeout 180s;
    fastcgi_send_timeout 180s;
    fastcgi_pass unix:@FPM_SOCK@;
}

# Berkas statis hasil build (asset ber-hash boleh di-cache lama); semua rute lain ke SPA.
location /assets/ {
    expires 30d;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
}
location / {
    add_header Cache-Control "no-cache";
    try_files $uri /index.html;
}

# Tidak ada yang lain yang boleh dilayani dari folder web
location ~ /\.(?!well-known) { deny all; }
