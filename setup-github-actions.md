# Setup GitHub Actions - Step by Step Guide

## 1. Push Code to GitHub

First, make sure your code is pushed to a GitHub repository:

```bash
git add .
git commit -m "Add auto attendance system with GitHub Actions"
git push origin main
```

## 2. Configure Repository Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add these secrets:

### Required Secrets:
- `UBL_USERNAME` = your UBL username (e.g., 2512510237)
- `UBL_PASSWORD` = your UBL password
- `COURSE_ID` = your course ID (e.g., 29050)
- `TELEGRAM_BOT_TOKEN` = your bot token (e.g., 7950123660:AAFHnzSmAgyNeVLiHfpmBAaitpvE35iFnTk)
- `TELEGRAM_CHAT_ID` = your chat ID (e.g., 1743712356)

## 3. Test the Workflow

1. Go to your repository → Actions tab
2. Click on "Auto Attendance UBL" workflow
3. Click "Run workflow" → "Run workflow" (manual trigger)
4. Monitor the execution

## 4. Verify Setup

After the first run:
- ✅ Check GitHub Actions tab for successful execution
- ✅ Check Telegram for notification message
- ✅ Verify logs in the Actions output

## 5. Schedule Configuration

The workflow is configured to run:
- **Automatically:** Every hour (cron: '0 * * * *')
- **Manually:** Via "Run workflow" button

## Troubleshooting

### If workflow fails:

1. **Check secrets:** Ensure all 5 secrets are set correctly
2. **Check logs:** View the Actions run logs for error details
3. **Test locally:** Run `node attendance_check.js` locally first
4. **Verify credentials:** Make sure UBL credentials are correct

### Common Issues:

- **"Telegram not configured"** → Check bot token and chat ID
- **"Authentication failed"** → Check UBL username/password
- **"Course not found"** → Verify course ID is correct

## Monitoring

- **GitHub Actions:** Check run history and logs
- **Telegram:** Monitor for notifications
- **Logs:** View detailed logs in Actions output

## Security Best Practices

✅ Use GitHub Secrets (never commit .env files)
✅ Regularly rotate passwords
✅ Monitor for unusual activity
✅ Keep dependencies updated

## Next Steps

1. **Test the workflow** by triggering it manually
2. **Monitor the first few runs** to ensure everything works
3. **Adjust schedule** if needed (modify cron in workflow file)
4. **Set up notifications** for workflow failures if desired 