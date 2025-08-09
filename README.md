# Auto Attendance UBL

Automated attendance system for UBL (Universitas Budi Luhur) e-learning platform with Telegram notifications.

## Features

- ✅ Automated attendance checking
- 📱 Telegram notifications
- 🔄 Scheduled runs via GitHub Actions
- 📊 Detailed logging and reporting
- 🚀 Lightweight and efficient

## Setup for GitHub Actions

### 1. Repository Secrets

Add these secrets to your GitHub repository (Settings > Secrets and variables > Actions):

```
UBL_USERNAME=your_ubl_username
UBL_PASSWORD=your_ubl_password
COURSE_ID=your_course_id
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
```

### 2. How to get Telegram Bot Token and Chat ID

1. **Create a Telegram Bot:**
   - Message [@BotFather](https://t.me/botfather) on Telegram
   - Send `/newbot` and follow instructions
   - Copy the bot token

2. **Get your Chat ID:**
   - Send a message to your bot
   - Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Look for `"chat":{"id":123456789}` - that number is your chat ID

### 3. GitHub Actions Workflow

The workflow will run automatically every hour and can be triggered manually.

## Local Development

### Install dependencies
```bash
npm install
```

### Create .env file
```bash
UBL_USERNAME=your_username
UBL_PASSWORD=your_password
COURSE_ID=your_course_id
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Run locally
```bash
# Run once
node attendance_check.js

# Run continuously (for testing)
node auto_attendance.js
```

## Files

- `attendance_check.js` - Lightweight version for GitHub Actions (runs once)
- `auto_attendance.js` - Full version with continuous monitoring
- `.github/workflows/auto-attendance.yml` - GitHub Actions workflow
- `scrape_ubl.js` - Core scraping logic

## How it works

1. **Authentication:** Logs into UBL e-learning platform
2. **Course Detection:** Finds attendance activities in the specified course
3. **Attendance Check:** Attempts to submit attendance for available sessions
4. **Notification:** Sends results to Telegram
5. **Logging:** Records all activities for debugging

## Monitoring

- Check GitHub Actions tab for run history
- View logs in the `logs/` directory
- Monitor Telegram for notifications

## Troubleshooting

### Common Issues

1. **"Telegram not configured"**
   - Check that `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set correctly

2. **"No attendance submission form found"**
   - This is normal when no attendance sessions are currently available
   - The script will keep checking periodically

3. **Authentication errors**
   - Verify your UBL credentials are correct
   - Check if the course ID is valid

### Debug Mode

For local debugging, you can run with verbose output:
```bash
node scrape_ubl.js --attend --all-attendance --verbose
```

## Security Notes

- Never commit your `.env` file
- Use GitHub Secrets for sensitive data
- The bot token and chat ID are safe to share (they're designed for this purpose)

## License

MIT License - feel free to modify and distribute. # autoabses
