# WAB DNS Discovery

The **Web Agent Bridge (WAB) DNS Discovery** mechanism allows AI agents to instantly discover if a domain supports WAB and locate its capabilities document (`wab.json`), without needing to send a single HTTP request to the website first.

This works exactly like SPF, DKIM, or DMARC records for email. By adding a simple TXT record to your domain's DNS, you announce your AI readiness to the world at the infrastructure level.

---

## How It Works

When an AI agent wants to interact with `example.com`, it performs a DNS lookup for a specific TXT record at `_wab.example.com`.

If the record exists, the agent immediately knows:
1. The domain explicitly supports AI interaction.
2. The exact URL where the `wab.json` capabilities document is located.

### The DNS Record Format

You need to create a **TXT record** with the following details:

| Field | Value | Description |
|---|---|---|
| **Type** | `TXT` | Text record |
| **Name / Host** | `_wab` | The subdomain prefix (results in `_wab.yourdomain.com`) |
| **Value** | `v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json` | The protocol version and the full URL to your capabilities file |
| **TTL** | `Auto` or `3600` | Time To Live (standard is fine) |

---

## Setup Guides for Major Providers

Here is how to add the WAB DNS record in the most popular DNS management platforms.

### 1. Cloudflare

Cloudflare is the most straightforward platform for adding TXT records.

1. Log in to your Cloudflare dashboard and select your domain.
2. Navigate to **DNS** > **Records** in the left sidebar.
3. Click the **Add record** button.
4. Set **Type** to `TXT`.
5. Set **Name** to `_wab`.
6. Set **Content** to `v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json` (replace `yourdomain.com` with your actual domain).
7. Leave **TTL** as `Auto`.
8. Click **Save**.

### 2. cPanel (Most Shared Hosting)

If you use shared hosting (like Bluehost, HostGator, or SiteGround), you likely use cPanel.

1. Log in to your cPanel dashboard.
2. Scroll down to the **Domains** section and click on **Zone Editor**.
3. Locate your domain in the list and click the **Manage** button next to it.
4. Click the arrow next to the **Add Record** button and select **Add "TXT" Record**.
5. In the **Name** field, enter `_wab` (cPanel will automatically append your domain, making it `_wab.yourdomain.com.`).
6. In the **Record** field, enter `v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json`.
7. Click **Add Record** or **Save Record**.

### 3. GoDaddy

GoDaddy requires you to manage DNS through their domain portfolio.

1. Log in to your GoDaddy account and go to your **Domain Portfolio**.
2. Click on the domain you want to configure to access its settings.
3. Click on the **DNS** tab, then select **DNS Records**.
4. Click the **Add New Record** button.
5. Select `TXT` from the **Type** dropdown menu.
6. In the **Name** field, type `_wab`.
7. In the **Value** field, paste `v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json`.
8. Leave **TTL** at the default setting (usually 1 Hour).
9. Click **Save**.

### 4. Namecheap

Namecheap manages DNS through their Advanced DNS tab.

1. Log in to your Namecheap account and go to the **Domain List**.
2. Click the **Manage** button next to your domain.
3. Navigate to the **Advanced DNS** tab.
4. In the **Host Records** section, click **Add New Record**.
5. Select `TXT Record` from the Type dropdown.
6. In the **Host** field, type `_wab`.
7. In the **Value** field, paste `v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json`.
8. Click the green checkmark icon to save changes.

---

## Verifying Your Setup

Because DNS changes can take time to propagate across the global internet (from a few minutes to 48 hours), you should verify that your record is correctly published.

You can verify your WAB DNS record using the command line on any computer:

```bash
# Using dig (macOS / Linux)
dig TXT _wab.yourdomain.com +short

# Using nslookup (Windows)
nslookup -type=TXT _wab.yourdomain.com
```

If the setup is correct, the command will output your record:
`"v=wab1; endpoint=https://yourdomain.com/.well-known/wab.json"`
