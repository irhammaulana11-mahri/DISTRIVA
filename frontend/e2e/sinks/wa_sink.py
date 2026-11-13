import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs
OUT = sys.argv[1]; PORT = int(sys.argv[2])

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n).decode()
        # Accept both body formats the driver can send: JSON (Starsender profile) and form-encoded.
        if "json" in (self.headers.get("Content-Type") or ""):
            data = json.loads(raw or "{}")
        else:
            data = {k: v[0] for k, v in parse_qs(raw).items()}
        # Normalise the Starsender field names to the ones the E2E scripts look for.
        if "to" in data and "target" not in data: data["target"] = data["to"]
        if "body" in data and "message" not in data: data["message"] = data["body"]
        with open(OUT, "a") as f:
            f.write(json.dumps({"auth": self.headers.get("Authorization"), **data}) + "\n")
        body = json.dumps({"status": True, "success": True}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass

HTTPServer(("127.0.0.1", PORT), H).serve_forever()
