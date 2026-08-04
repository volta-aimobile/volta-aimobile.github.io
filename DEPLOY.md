# How to Publish Volta App Online

This guide shows you 3 ways to put Volta App on the internet so anyone can use it.
Pick the one that sounds easiest to you.

---

## Option A: Render.com (RECOMMENDED - Free & Easiest)

Render gives you a free public URL like `https://volta-app.onrender.com`.

### Steps

1. **Create a GitHub account** (free): https://github.com/signup
2. **Create a new repository**:
   - Go to https://github.com/new
   - Name it `volta-app`
   - Click **Create repository**
3. **Upload all the files**:
   - Click **uploading an existing file**
   - Drag ALL the files from your `volta-app` folder (except `node_modules` and `data`)
   - Click **Commit changes**
4. **Create a Render account** (free): https://render.com/signup
5. **Deploy**:
   - Go to https://dashboard.render.com
   - Click **New +** → **Blueprint**
   - Connect your GitHub account
   - Select the `volta-app` repository
   - Render detects `render.yaml` automatically → click **Apply**
   - Wait 2-3 minutes for build to finish
6. **Your app is live!** Render gives you a URL like:
   ```
   https://volta-app-xxxx.onrender.com
   ```

### Notes
- Free tier sleeps after 15 min of inactivity (first request takes ~30 sec to wake)
- 1 GB persistent disk keeps your database (users, meals, etc.)
- To enable real email OTP, add SMTP env vars in Render dashboard

---

## Option B: Railway.app (Free Trial, Then $5/month)

Railway is simpler than Render but costs money after the trial.

### Steps

1. Go to https://railway.app → **Login** with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `volta-app` repository
4. Railway detects `railway.json` → click **Deploy**
5. Wait 2 minutes → get your URL: `https://volta-app.up.railway.app`

---

## Option C: Share From Your Computer (No Deployment)

Use Cloudflare Tunnel to share your localhost with anyone — your computer must stay on.

### Steps

1. Start Volta locally (double-click `START-Windows.bat`)
2. Download Cloudflare Tunnel: https://github.com/cloudflare/cloudflared/releases/latest
   - Download `cloudflared-windows-amd64.exe`
   - Rename it to `cloudflared.exe`
   - Put it in your `volta-app` folder
3. Open Command Prompt in the `volta-app` folder and run:
   ```
   cloudflared.exe tunnel --url http://localhost:4000
   ```
4. Cloudflare gives you a public URL like:
   ```
   https://random-words-xxxx.trycloudflare.com
   ```
5. Share that URL with anyone — they can use your app

### Notes
- URL changes every time you restart the tunnel
- Your computer must stay on and the tunnel must keep running
- Free, no account needed

---

## Which option should I pick?

| Option | Cost | Difficulty | URL stays same? | Computer must stay on? |
|--------|------|------------|-----------------|----------------------|
| Render | Free | Medium | Yes | No |
| Railway | $5/mo after trial | Easy | Yes | No |
| Cloudflare Tunnel | Free | Easy | No | Yes |

**For publishing to the public: use Render (Option A).**

---

## Enabling Real Email OTP (Optional)

By default, OTP codes are shown in the API response (dev mode). To send real emails:

1. Sign up for a free SMTP service:
   - **Brevo** (free, 300 emails/day): https://www.brevo.com
   - **Resend** (free, 100 emails/day): https://resend.com
   - **SendGrid** (free, 100 emails/day): https://sendgrid.com
2. Get your SMTP credentials
3. Add these env vars in your hosting dashboard:
   ```
   SMTP_HOST=smtp.brevo.com
   SMTP_PORT=587
   SMTP_USER=your@email.com
   SMTP_PASS=your-smtp-key
   SMTP_FROM=Volta App <no-reply@yourdomain.com>
   OTP_DEV_IN_RESPONSE=false
   ```
4. Redeploy

Now users get real OTP emails instead of seeing codes in the response.
