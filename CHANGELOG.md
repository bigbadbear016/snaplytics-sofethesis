# Changelog

## 2026-11-12 - Renewal shadow mode

### Renewal shadow and training

- Daily shadow predictions use live Supabase booking data.
- Successful daily shadow runs are recorded quietly.
- Failed shadow runs show an Electron notification.
- Shadow monitoring is always on and has no switch.
- Mature outcomes can be checked with `evaluate_renewal_shadow`.
- Metrics can be viewed with `report_renewal_shadow_metrics`.
- Monthly training uses `run_renewal_monthly.ps1`.
- With automatic training OFF, the monthly job creates an approval notice.
- With automatic training ON, the monthly job starts challenger training and
  still shows a notice to staff and admins.
- Only ADMIN or OWNER can approve manual training or change automatic training.
- Candidate models never replace the live heuristic automatically.
- Training notices remain visible for 30 days.

### Setup

Run migrations once from the `Snaplytics` folder:

```powershell
python manage.py migrate
```

Use Windows Task Scheduler for:

- `scripts\run_renewal_shadow.ps1` — daily
- `scripts\run_renewal_monthly.ps1` — monthly
