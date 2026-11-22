# DISTRIVA: dashboard statis (React) + /api ke Laravel lewat PHP-FPM kolam "distriva". Dibuat dari templat oleh bin/render-nginx.sh; jangan diedit tangan di /etc.
# Satu origin: peramban memanggil /api di host yang sama (tanpa CORS).
limit_req_zone $binary_remote_addr zone=distriva_api:10m rate=20r/s;

@SERVERS@
