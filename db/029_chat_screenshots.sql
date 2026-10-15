-- Order-history screenshots sent in the chat (lib/order-screenshots.js) become a purchase-history
-- source. Their evidence rows use the new origin chat_screenshot, which "Delete imported history"
-- removes along with Gmail and Shop evidence (purchase_history = true).
-- Run once after 028_reply_reliability.sql and BEFORE deploying the code that uses it: without this
-- row the evidence foreign key rejects the write, and Jules says the screenshot couldn't be saved.
insert into public.evidence_origins(origin,purchase_history) values ('chat_screenshot',true)
on conflict (origin) do update set purchase_history=excluded.purchase_history;
