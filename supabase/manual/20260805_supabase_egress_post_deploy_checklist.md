# Supabase egress post-deploy checklist

## Scope
Use this checklist after every deploy that touches:
- client/admin inbox refresh logic
- realtime subscriptions
- Supabase RPC or SELECT payload size
- service worker or push delivery

## 1) Validate in Supabase Dashboard

1. Logs Explorer
- Filter by time window after deploy.
- Group by endpoint and status code.
- Confirm there is no sustained request burst from the same user/session every few seconds.

2. API Logs
- Sort by total bytes returned.
- Verify top read endpoints are expected (appointments, messages, requests).
- Compare request frequency before/after deploy.

3. Edge Function logs
- Check send-web-push invocation rate.
- Confirm no unexpected retries or repeated unauthorized calls.

4. Auth logs
- Verify no abnormal sign-in/sign-out or token-refresh loops.

5. Realtime logs
- Confirm subscription count is stable.
- Check for reconnect storms or repeated channel joins from the same client.

6. Cron jobs / pg_cron
- Confirm no active jobs are calling chat/request/appointment functions unexpectedly.

7. Database webhooks
- Confirm no webhook sends full-row payloads at high frequency.

8. Storage access logs
- Confirm no unexpected signed URL storms or bulk object downloads.

## 2) Expected client behavior after this fix

1. No 3-second polling loops for inbox/appointments/messages.
2. Refresh loops run only in visible tabs.
3. Fallback refresh loop runs at 60s cadence, with exponential backoff on failures.
4. Foreground and realtime triggers are deduplicated to avoid overlapping refresh bursts.

## 3) Local verification in dev build

1. Open browser console.
2. Watch for warning payloads with prefixes:
- [supabase-traffic]
- [supabase-refresh-loop]
3. If warnings appear, inspect the labeled endpoint and find repeated triggers.

## 4) Quick rollback criteria

Rollback or hotfix immediately if either condition is true:
1. Daily egress trend projects above free-tier limit without real user growth.
2. Same endpoint appears in API logs with near-constant cadence from one session.
