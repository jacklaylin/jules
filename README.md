# Personal Shopper — Milestone 1

Prototype for an AI personal shopper that learns a customer's taste, shops across the fragmented retail internet, and helps execute shopping intent.

## Product thesis

**The internet solved access to inventory. It did not solve shopping.**

The intended hierarchy is:

**Person → taste → intent → product → best source → transaction**

See [`PRD.md`](./PRD.md) for the product specification and [`AGENTS.md`](./AGENTS.md) for development instructions.

## Current stage

V0 founder prototype. Maximum 10 initial testers.

Milestone 1 is implemented locally. **The live phone acceptance test has not passed yet.**

## Architecture

Twilio posts incoming messages to `POST /api/sms` on Vercel. A Python function
validates the signature and returns TwiML instructing Twilio to send
`Hello from your personal shopper.` Every valid message gets the fixed reply.
There are no third-party dependencies, database, AI, or admin UI.

Structured logs contain event, HTTP status, and MessageSid for correlation
with Twilio. They omit phone numbers, message bodies, and credentials.
`sms_received` means a response was prepared, not that the phone received it.
Logs are not permanent conversation storage. A database and conversation
schema can be introduced in Milestone 2 when needed for admin.

`api/sms.py` contains the webhook and optional local server;
`tests/test_sms.py` covers reply and authentication logic;
`.env.example` contains placeholders only.

## Local verification

Requires Python 3.9 or newer. Run from the repository folder:

```sh
python3 -m unittest discover -s tests -v
```

Tests use fake credentials and sender labels and do not send SMS.
For optional local development, set both environment variables in your shell
and run `python3 api/sms.py`. This serves localhost port 8000; it does not load
`.env` automatically. Unsigned requests correctly return 403 when configured.
Twilio cannot reach localhost; use deployment for the phone test.

## Founder setup

### 1. Twilio

Create or open your account in [Twilio Console](https://console.twilio.com/)
and provision a number with SMS capability. This produces the phone number
you will text; keep it in Twilio, not source code.

Find the **Auth Token** for the account owning the number. It verifies that
webhook requests came from Twilio. Store it only in Vercel's private
`TWILIO_AUTH_TOKEN` environment variable below. Do not paste it into this chat,
source code, or Git. No OpenAI key, Supabase account, Account SID environment
variable, or retailer credentials are needed.

Verify your test recipient phone if prompted by the trial flow. Follow any
messaging eligibility or registration requirements displayed for your account
and number before testing.

### 2. Vercel

Hosting gives Twilio a public HTTPS endpoint that works when your laptop is
off. Push the repository to your GitHub account. In
[Vercel](https://vercel.com/new), select **Add New → Project** and import it.
Choose framework preset **Other**, repository root as the root directory,
and default build/output settings. Deploy.

Copy the stable production domain and append `/api/sms`, for example
`https://your-project.vercel.app/api/sms`. This is your webhook URL. Use the
production domain rather than a temporary preview URL.

In project **Settings → Environment Variables**, add for **Production**:

| Name | Value |
| --- | --- |
| `TWILIO_AUTH_TOKEN` | Private Auth Token from the Twilio account owning the number |
| `TWILIO_WEBHOOK_URL` | Exact production HTTPS URL ending in `/api/sms` |

Redeploy after saving. Signature validation includes the complete URL, so
use exactly the same URL in Twilio, with no trailing slash or query string.
Ensure production deployment protection does not require a Vercel login to
reach this endpoint. Opening it in a browser should produce **405 Method Not
Allowed** because it accepts POST. A login page means Twilio cannot reach it.

### 3. Connect the number

In Twilio Console, go to **Phone Numbers → Manage → Active numbers**, select
your SMS number, and open messaging configuration. Under **A message comes
in**, choose **Webhook**, paste the same URL as `TWILIO_WEBHOOK_URL`, select
**HTTP POST**, and save.

### 4. Acceptance test

1. From your phone, text `hello` to the Twilio number.
2. Confirm Vercel function logs show `sms_received` and HTTP status 200.
3. Confirm your phone receives `Hello from your personal shopper.` Twilio may
   prepend trial account text.
4. Check Twilio messaging logs for the incoming message and outgoing reply.
5. Record date, deployment, MessageSid, and pass/fail in a private test note.
   Do not record phone numbers or message bodies in Git.

**Milestone 1 is complete only after the live test passes.**

Troubleshooting:
- **401/login page:** check Vercel production deployment protection.
- **403/signature_rejected:** compare URLs in both services and check that
  the Auth Token belongs to the same Twilio account as the number.
- **503/configuration_error:** add both production variables and redeploy.
- **404:** check the `/api/sms` path and correct project deployment.
- **200 but no reply:** check Twilio messaging logs/Debugger for the outgoing
  error and follow recipient or messaging eligibility guidance.

## Later milestones

Only when asked: admin/manual replies → AI conversation → structured taste
memory → images → product search → human fallback → watches.
Broad commerce verification and continuous discovery add substantial
complexity; preserve human review when those milestones arrive.

References: [Vercel Python functions](https://vercel.com/docs/functions/runtimes/python),
[Twilio signature validation](https://www.twilio.com/docs/usage/security),
and [messaging TwiML](https://www.twilio.com/docs/messaging/twiml).
