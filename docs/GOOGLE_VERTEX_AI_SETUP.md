# Setting Up Google Gemini via Vertex AI

Substrate uses **Vertex AI** (not the standard Google AI Studio API key) to access Gemini models. This is because the standard `generativelanguage.googleapis.com` API is often blocked at the project level, returning 403 errors. Vertex AI provides reliable, production-grade access.

## Overview

You'll need:
1. A Google Cloud project
2. The Vertex AI API enabled
3. A **service account** with a downloaded JSON key file
4. The JSON key file path configured in Substrate settings

---

## Step-by-Step Setup

### 1. Create or Select a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top → **New Project** (or select an existing one)
3. Give it a name and click **Create**
4. Make sure the project is selected in the top dropdown

### 2. Enable the Vertex AI API

1. Go to **APIs & Services → Library** (or search "Vertex AI API" in the console search bar)
2. Find **Vertex AI API** and click **Enable**
3. This may take a moment — wait for confirmation

> **Note:** You may also want to enable the **Generative Language API** if prompted, but Vertex AI API is the primary requirement.

### 3. Create a Service Account

1. Go to **IAM & Admin → Service Accounts**
2. Click **+ Create Service Account**
3. Give it a name (e.g., `vertex-express`) and description
4. Click **Create and Continue**
5. For the role, assign **Vertex AI User** (`roles/aiplatform.user`)
   - You can search for "Vertex AI User" in the role dropdown
   - This gives the account permission to call Gemini models
6. Click **Continue** → **Done**

### 4. Download the Service Account Key (JSON)

1. In the Service Accounts list, click on the service account you just created
2. Go to the **Keys** tab
3. Click **Add Key → Create new key**
4. Select **JSON** format
5. Click **Create** — a `.json` file will download automatically
6. **Save this file** somewhere accessible (e.g., your Downloads folder)

> ⚠️ **Security:** This JSON file contains private credentials. Don't commit it to version control or share it publicly.

### 5. Configure Substrate

1. Open Substrate
2. Go to **Settings** (radial menu → API Settings section)
3. Find the **Google** provider section
4. Paste the **full file path** to your downloaded JSON key file into the **Vertex AI Service Account** field
   - Example: `C:\Users\YourName\Downloads\my-project-abc123.json`
5. The setting auto-saves — models will be discovered automatically
6. Select a Gemini model from the dropdown (e.g., `gemini-2.5-flash`, `gemini-2.5-pro`)

### 6. Verify It Works

- Send a test message in chat
- If there's an error, the actual error message will be displayed (e.g., model not found, auth issue)
- Check that models appear in the model dropdown under Google

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"PyJWT library not installed"** | Run: `& "<app-venv-path>\Scripts\python.exe" -m pip install "PyJWT[crypto]"`. The app venv is at `%APPDATA%\Substrate\venv\`. |
| **404 / Model not found** | The model name doesn't exist on Vertex AI. Open settings and pick a valid model from the dropdown. |
| **403 / Permission denied** | The service account doesn't have the **Vertex AI User** role. Go to IAM & Admin → IAM and add the role. |
| **403 / API not enabled** | Enable the **Vertex AI API** in APIs & Services → Library. |
| **"API key blocked"** | This means you're using a standard API key instead of Vertex AI. Use a service account JSON file instead. |
| **No models in dropdown** | Check that the JSON path is correct and the file exists. Restart the app after configuring. |
| **Token refresh errors** | The JSON file may be corrupted or expired. Generate a new key from the Service Accounts page. |

---

## How It Works (Technical)

- Substrate reads the service account JSON file and uses **PyJWT** to sign a JWT
- The JWT is exchanged for a short-lived OAuth2 access token via Google's token endpoint
- Access tokens are cached and auto-refreshed (1-hour lifetime)
- All Gemini API calls go through `us-central1-aiplatform.googleapis.com` (Vertex AI endpoint)
- Model discovery uses the Vertex AI publisher models API to list available Gemini models

---

## Region

By default, Substrate uses the `us-central1` region. This can be changed via the `vertex_ai_region` config key if needed. Most Gemini models are available in `us-central1`.
