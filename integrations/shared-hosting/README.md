# WAB for Shared Hosting & Website Builders

Web Agent Bridge (WAB) can be installed on **any shared hosting provider** (Hostinger, cPanel, Bluehost, GoDaddy) and **website builders** (Wix, Squarespace) without needing server root access, Node.js, or command-line tools.

## Choose Your Integration Level

| Level | Requirements | Features | Best For |
|---|---|---|---|
| **Level 1: Static Discovery** | Upload 1 JSON file | Exposes site metadata, read-only discovery | Wix, Squarespace, Webflow |
| **Level 2: PHP Bridge** | Upload 1 PHP file | Full AI agent interaction (Read, Search, Form submit) | Hostinger, cPanel, WordPress |
| **Level 3: Full DNS** | Level 2 + DNS TXT | Zero-request discovery + Full interaction | Advanced users |

---

## Level 1: Static Discovery (Wix, Squarespace, Webflow)

If your platform doesn't support PHP (like Wix or Squarespace), you can still make your site AI-ready by uploading a static `wab.json` file.

### How to install:
1. Download the [`generate-wab-json.php`](generate-wab-json.php) file to your local computer.
2. Run it locally (if you have PHP) or open it in a text editor to manually create your `wab.json`.
3. **Wix / Squarespace:** Since you cannot create a `.well-known` folder directly:
   - Create a hidden page named `wab.json`
   - Set the URL slug to `/.well-known/wab.json`
   - Paste the JSON content directly into a Code Block or raw text block on that page.
   - *Alternatively*, use the **Level 3 DNS TXT Record** method (highly recommended for website builders).

---

## Level 2: PHP Bridge (Hostinger, cPanel, Bluehost, GoDaddy)

If your host supports PHP (almost all shared hosts do), you can enable full AI agent interaction by dropping a single file into your File Manager.

### Step 1: Upload the Bridge
1. Log in to your hosting panel (Hostinger hPanel or cPanel).
2. Open the **File Manager**.
3. Navigate to your `public_html` (or `www`) folder.
4. Upload [`wab-bridge.php`](wab-bridge.php) to this folder.
5. Open `wab-bridge.php` in the File Manager's text editor.
6. Change the `'secret_key'` to a long random password. Save and close.

### Step 2: Generate Discovery Document
1. Upload [`generate-wab-json.php`](generate-wab-json.php) to the same folder.
2. Open your browser and visit: `https://yourdomain.com/generate-wab-json.php`
3. Click **Download wab.json**.
4. In your File Manager, create a new folder named `.well-known` inside `public_html`.
5. Upload the downloaded `wab.json` into the `.well-known` folder.
6. **Important:** Delete `generate-wab-json.php` from your server for security.

### Step 3: Test It
Visit `https://yourdomain.com/wab-bridge.php/ping` in your browser. You should see:
```json
{"status": "ok", "wab": "1.0.0", "timestamp": 1713000000}
```

---

## Level 3: Full DNS Discovery (Highly Recommended)

To make your site discoverable without AI agents needing to scan your HTTP headers, add a DNS TXT record. This is especially useful for Wix/Squarespace users.

1. Go to your domain registrar's DNS settings (Cloudflare, Namecheap, GoDaddy, etc.).
2. Add a new **TXT Record**:
   - **Name/Host:** `_wab`
   - **Value:** `"v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json"`

For full step-by-step DNS instructions, see [DNS-DISCOVERY.md](../../DNS-DISCOVERY.md).

---

## Security Notes
- The PHP bridge requires agents to send your `secret_key` as a Bearer token in the `Authorization` header for any action other than discovery.
- Form submissions and contact messages are **disabled by default**. You must explicitly enable them in `wab-bridge.php`.
- The bridge strictly enforces CORS and domain-matching to prevent abuse.
