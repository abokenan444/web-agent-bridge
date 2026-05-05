# Publishing the WAB VS Code extension

> **Security note:** never paste passwords or PATs into chat. Generate them
> yourself and treat them like API keys.

## 1. Install build tools

```bash
cd vscode-wab
npm install
npm run compile      # type-check + emit ./out/extension.js
npm run package      # produces wab-0.1.0.vsix
```

You can side-load the resulting `.vsix` via VS Code → *Extensions* → … →
**Install from VSIX…**.

## 2. Publish to the VS Code Marketplace

1. Create a publisher named `webagentbridge` at https://marketplace.visualstudio.com/manage.
2. Generate a **Personal Access Token** in Azure DevOps:
   - Go to https://dev.azure.com → user settings → Personal Access Tokens.
   - Organization: *All accessible organizations*.
   - Scopes: **Marketplace → Manage**.
3. Sign in `vsce` once:
   ```bash
   npx vsce login webagentbridge
   # paste the PAT when prompted
   ```
4. Publish:
   ```bash
   npm run publish:vsce
   ```

## 3. Mirror to Open VSX (for VSCodium / Cursor / etc.)

1. Sign in at https://open-vsx.org with GitHub.
2. Create a namespace `webagentbridge`.
3. Generate a token at https://open-vsx.org/user-settings/tokens.
4. ```bash
   export OVSX_PAT=...        # do NOT commit
   npm run publish:ovsx
   ```

## 4. Versioning

```bash
npm version patch    # 0.1.1
npm run publish:vsce
npm run publish:ovsx
```

## 5. Required marketplace icon

The Marketplace requires a 128×128 PNG. Drop it at `media/icon.png`, then add
back to `package.json`:

```json
"icon": "media/icon.png",
```
