# Changelog

## 2026-11-12 - Renewal shadow mode

### Added

- Added a table for saving renewal predictions.
- Added a daily command to make predictions from current Supabase data.
- Added a command to check old predictions after 365 days.
- Added a command to show accuracy, precision, recall, and the always-no baseline.

### Safety

- Shadow predictions do not change the live customer experience.
- The current renewal formula is still used by the live API.
- Predictions are saved with a date and model version.
- The same daily command can be run again without creating duplicate records.

### How to run

From the `Snaplytics` folder:

```powershell
python manage.py migrate
python manage.py run_renewal_shadow
```

For localhost automation, use
`Snaplytics/scripts/run_renewal_shadow.ps1` with Windows Task Scheduler once
per day. The script runs migrations first, then records the daily predictions.

To check predictions whose 365-day period is complete:

```powershell
python manage.py evaluate_renewal_shadow
python manage.py report_renewal_shadow_metrics
```

### Not included yet

- Automatic model replacement
- Automatic customer messages

Monthly challenger training is now available through
`Snaplytics/scripts/run_renewal_monthly.ps1`. It trains only when enough
365-day outcomes are complete, saves a candidate model and metrics, and does
not replace the current live formula.

### Training approval

- The monthly job creates a training request instead of training right away.
- Staff and admins see the request in the Electron notification panel.
- Only ADMIN or OWNER can approve and start training.
- Approval is recorded in the action log.
- ADMIN or OWNER can turn automatic monthly training on or off.
- When automatic training is off, the monthly job creates an approval notice.
- When it is on, the monthly job starts guarded challenger training automatically.
- Automatic training also creates a notice for staff and admins after the monthly job runs.
- Automatic training notices stay visible for 30 days.
