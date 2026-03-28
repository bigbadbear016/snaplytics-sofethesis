-- Supabase pg_cron: Send pending coupon emails
-- Prerequisites: Enable pg_cron and pg_net in Supabase Dashboard > Database > Extensions
-- Replace YOUR-DJANGO-URL with your deployed Django URL (e.g. https://your-app.herokuapp.com)
-- Replace YOUR_CRON_SECRET with the value from .env CRON_SECRET

SELECT cron.schedule(
  'send-coupon-emails',
  '* * * * *',  -- Every minute
  $$
  SELECT net.http_post(
    url := 'https://YOUR-DJANGO-URL/api/cron/send-coupon-emails/',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    ),
    body := '{}'
  );
  $$
);
