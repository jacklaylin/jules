import base64
import hashlib
import hmac
import unittest
from urllib.parse import urlencode
from xml.etree import ElementTree

from api.sms import process_sms, valid_signature


class SmsTests(unittest.TestCase):
    def setUp(self):
        self.env = {"TWILIO_AUTH_TOKEN": "test-token", "TWILIO_WEBHOOK_URL": "https://example.com/api/sms"}
        self.params = {"MessageSid": "SMtest", "From": "test-sender", "To": "test-recipient", "Body": "hello"}

    def request(self, params=None, signature=None, env=None, content_type="application/x-www-form-urlencoded"):
        params = self.params if params is None else params
        payload = self.env["TWILIO_WEBHOOK_URL"] + "".join(key + params[key] for key in sorted(params))
        signed = base64.b64encode(hmac.new(b"test-token", payload.encode(), hashlib.sha1).digest()).decode()
        return process_sms(urlencode(params).encode(), content_type, signed if signature is None else signature, self.env if env is None else env)

    def test_hello_returns_exact_greeting(self):
        status, body, event = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(ElementTree.fromstring(body).find("Message").text, "Hello from your personal shopper.")
        self.assertEqual(event["message_sid"], "SMtest")
        self.assertNotIn("test-sender", str(event))
        self.assertNotIn("hello", str(event))

    def test_rejects_missing_or_invalid_signature(self):
        for signature in ("", "invalid"):
            self.assertEqual(self.request(signature=signature)[0], 403)

    def test_changed_body_is_rejected(self):
        payload = self.env["TWILIO_WEBHOOK_URL"] + "Bodyhello"
        signed = base64.b64encode(hmac.new(b"test-token", payload.encode(), hashlib.sha1).digest()).decode()
        self.assertTrue(valid_signature("test-token", self.env["TWILIO_WEBHOOK_URL"], {"Body": ["hello"]}, signed))
        self.assertFalse(valid_signature("test-token", self.env["TWILIO_WEBHOOK_URL"], {"Body": ["changed"]}, signed))

    def test_configuration_fails_closed(self):
        self.assertEqual(self.request(env={})[0], 503)

    def test_wrong_content_type(self):
        self.assertEqual(self.request(content_type="application/json")[0], 415)

    def test_missing_message_fields(self):
        self.assertEqual(self.request(params={"Body": "hello"})[0], 400)

    def test_future_twilio_fields_are_signed(self):
        self.assertEqual(self.request(params={**self.params, "FutureField": "value"})[0], 200)

    def test_other_messages_also_get_fixed_reply(self):
        self.assertEqual(self.request(params={**self.params, "Body": "something else"})[1], self.request()[1])


if __name__ == "__main__":
    unittest.main()
