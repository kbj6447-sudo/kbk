# Render free deploy

This app needs a Node web service because the browser calls `/api/scanner`, `/api/quote`, `/api/backtest`, and `/api/exchange`.

## Deploy

1. Create a GitHub repository and upload this folder.
2. Go to Render and create a new Blueprint or Web Service from that repository.
3. If Render asks for commands, use:
   - Build command: `npm install`
   - Start command: `npm start`
4. Keep the instance type on the free plan.

The app reads Render's `PORT` environment variable automatically. No extra environment variables are required.

## Notes

Render free web services can sleep after inactivity. The first request after sleep may take a little longer.
