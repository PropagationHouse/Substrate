# Windsurf to Substrate Migration Guide

## What to Save from Windsurf

Substrate doesn't use Windsurf's config files, but you'll want these credentials/services:

### 1. LLM API Keys
**Where Windsurf stores:** Settings → Models → API Keys  
**Where Substrate expects them:** `custom_settings.json` (in project root) or environment variables

```json
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "remote_api_keys": {
    "openai_api_key": "sk-...",
    "anthropic_api_key": "sk-ant-...",
    "google_api_key": "..."
  },
  "provider": "anthropic"
}
```

**Or via environment variables:**
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY` 
- `GOOGLE_API_KEY`

### 2. GitHub / Git Config
**Windsurf:** Settings → Git  
**Substrate:** Uses system git config (no migration needed)

```bash
# Check current git config
git config --list
```

### 3. Vercel / Deployment
**Windsurf:** May have Vercel CLI tokens  
**Substrate:** No built-in Vercel integration. Save your Vercel token if you use it:

```bash
# Check if you have Vercel CLI auth
vercel whoami
# Save token to Substrate config if needed
```

### 4. Database / External Services
**Windsurf:** May have database URLs, API tokens  
**Substrate:** Add to `custom_settings.json`:

```json
{
  "database_url": "postgresql://...",
  "stripe_api_key": "sk_live_...",
  "vercel_token": "..."
}
```

### 5. Project-Specific Config
**Windsurf:** `.windsurf/` directory  
**Substrate:** `config.json` (base config) + `custom_settings.json` (your overrides)

### 6. MCP Servers
**Windsurf:** Settings → MCP  
**Substrate:** `config/mcp_servers.json`

```json
{
  "servers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
      }
    }
  }
}
```

## Quick Migration Checklist

### Step 1: Export API Keys
From Windsurf Settings → Models → API Keys:
- [ ] OpenAI API key
- [ ] Anthropic API key  
- [ ] Google API key
- [ ] Any other LLM providers

### Step 2: Check Git Config
```bash
git config --global user.name
git config --global user.email
```

### Step 3: Check External Services
- [ ] Database URLs
- [ ] Vercel CLI token (`vercel whoami`)
- [ ] Any service API keys (Stripe, Twilio, etc.)

### Step 4: Create Substrate Config
Create `custom_settings.json` with the keys you collected.

### Step 5: Test Core Services
Run `python diag_opencode.py` to verify:
- [ ] OpenCode CLI found
- [ ] Patch tool working
- [ ] Tool registry loading

### Step 6: Save This Document
Keep this file as a reference. Add any service-specific notes below:

---

## Service-Specific Notes
*(Add your own services here)*

### Example: My Project Uses
- **Vercel deployment**: `vercel token export` → save to config
- **PostgreSQL**: `DATABASE_URL` → save to config  
- **Stripe**: `sk_live_...` → save to config
- **GitHub MCP**: Personal access token → `config/mcp_servers.json`
