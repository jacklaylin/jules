"""Milestone 1: authenticated inbound SMS → fixed TwiML reply."""

import base64
import hashlib
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

REPLY = b'<?xml version="1.0" encoding="UTF-8"?><Response><Message>Hello from your personal shopper.</Message></Response>'
MAX_BODY_BYTES = 65536


def valid_signature(token, url, params, signature):
    # Twilio includes every form field, including fields added in the future.
    payload = url
    for key in sorted(params):
        for value in sorted(set(params[key])):
            payload += key + value
    digest = hmac.new(token.encode(), payload.encode(), hashlib.sha1).digest()
    expected = base64.b64encode(digest).decode()
    return hmac.compare_digest(expected, signature)


def process_sms(body, content_type, signature, environ):
    token = environ.get("TWILIO_AUTH_TOKEN", "")
    url = environ.get("TWILIO_WEBHOOK_URL", "")
    if not token or not url or "replace-with" in token:
        return 503, b"Webhook configuration missing", {"event": "configuration_error"}
    if content_type.split(";", 1)[0].strip().lower() != "application/x-www-form-urlencoded":
        return 415, b"Expected form data", {"event": "unsupported_content_type"}
    try:
        params = parse_qs(body.decode("utf-8"), keep_blank_values=True, max_num_fields=1000)
    except (UnicodeDecodeError, ValueError):
        return 400, b"Invalid form data", {"event": "invalid_form"}
    if not valid_signature(token, url, params, signature):
        return 403, b"Invalid signature", {"event": "signature_rejected"}
    if not all(len(params.get(key, [])) == 1 and params[key][0] for key in ("MessageSid", "From", "To")):
        return 400, b"Missing message fields", {"event": "invalid_message"}
    # Message identifiers correlate with Twilio logs; no phone numbers or bodies.
    sid = params["MessageSid"][0]
    event = {"event": "sms_received", "message_sid": sid, "reply": "fixed_greeting"}
    return 200, REPLY, event


class handler(BaseHTTPRequestHandler):
    def respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/xml; charset=utf-8" if status == 200 else "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.send_response(405)
        self.send_header("Allow", "POST")
        self.end_headers()

    def do_POST(self):
        configured_path = urlsplit(os.environ.get("TWILIO_WEBHOOK_URL", "")).path
        if self.path != (configured_path or "/api/sms"):
            self.respond(404, b"Not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.respond(400, b"Invalid content length")
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self.respond(413 if length > MAX_BODY_BYTES else 400, b"Invalid body size")
            return
        status, body, event = process_sms(
            self.rfile.read(length), self.headers.get("Content-Type", ""),
            self.headers.get("X-Twilio-Signature", ""), os.environ,
        )
        print(json.dumps({**event, "http_status": status}), flush=True)
        self.respond(status, body)

    def log_message(self, format, *args):
        # Avoid the default access log, which includes client addresses.
        pass


if __name__ == "__main__":
    print("SMS webhook listening at http://localhost:8000/api/sms", flush=True)
    HTTPServer(("127.0.0.1", 8000), handler).serve_forever()

