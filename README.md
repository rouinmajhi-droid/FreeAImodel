# NexusGate - Universal AI API Gateway & Management Dashboard

> A high-performance, full-stack OpenAI-compatible API Gateway and Management Dashboard with multi-provider automatic failover, dynamic model discovery, key rotation, and $50 Billion free developer credit allocation.

---

## 1. System Overview & Architecture

NexusGate acts as a resilient proxy and intelligent router between client applications (OpenAI SDK, LangChain, cURL, web frontends) and upstream AI inference providers (Groq, OpenAI, Google Gemini, OpenRouter, DeepSeek, Mistral, Cerebras).

### Architecture Diagram

```
                     ┌────────────────────────────────────────┐
                     │          Client Applications           │
                     │  (OpenAI SDK, cURL, LangChain, Apps)   │
                     └───────────────────┬────────────────────┘
                                         │ Bearer sk-gateway-...
                                         ▼
 ┌────────────────────────────────────────────────────────────────────────────┐
 │                            NexusGate API Router                            │
 ├────────────────────────────────────────────────────────────────────────────┤
 │  [Middleware 1: Gateway Key & Quota Validation]                            │
 │  • Authenticates `sk-gateway-...` token                                    │
 │  • Deducts token cost from $50B Developer Credit Pool                      │
 │  • Enforces concurrency and user-level rate limits                         │
 ├────────────────────────────────────────────────────────────────────────────┤
 │  [Middleware 2: Dynamic Multi-Key Failover & Load Balancer]                │
 │  • Resolves requested model across registered provider keys                │
 │  • Attempts request on Primary Active Key (Priority 1)                     │
 │  • Catches 429 (Rate Limit) / 402 (Exhausted) instantly                    │
 │  • Automatic Failover: Key 1 ➔ Key 2 ➔ Key 3 ... sequentially              │
 │  • Resilient Fallback to Gemini High-Availability engine                   │
 │  • Supports Server-Sent Events (SSE) streaming & standard JSON             │
 └───────────────────┬───────────────────┬───────────────────┬────────────────┘
                     │                   │                   │
                     ▼                   ▼                   ▼
            ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
            │   Groq Cloud    │ │   OpenAI API    │ │  Google Gemini  │
            │ (Llama 3.3/8B)  │ │ (GPT-4o / Mini) │ │ (2.0 Flash/Pro) │
            └─────────────────┘ └─────────────────┘ └─────────────────┘
                     │                   │                   │
                     ▼                   ▼                   ▼
            ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
            │   OpenRouter    │ │  DeepSeek V3/R1 │ │ Mistral/Cerebras│
            └─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## 2. Key Features

- **OpenAI-Compatible Drop-In API**: Seamless drop-in replacement for the official OpenAI SDK. Just change your `base_url` to `https://<your-domain>/v1`.
- **$50 Billion Free Credits Pool**: Prominent credit allocation banner with sub-cent cost calculation and telemetry monitoring.
- **Dynamic Bulk Key Ingestion**: Admins can paste 10, 50, or hundreds of provider keys at once. Keys append line-by-line without overwriting active keys.
- **Automatic Model Auto-Discovery**: Upon saving keys, the gateway automatically queries `/v1/models` from upstream providers to auto-discover model IDs (`llama-3.3-70b-versatile`, `gpt-4o`, `gemini-2.0-flash`, etc.).
- **Zero-Downtime 429 Failover**: When upstream rate limits are encountered, requests instantly rotate to the next key in the pool with zero client errors.
- **Firebase Authentication & Admin Gate**: Google OAuth authentication with restricted `/admin` access control designated for administrative emails (`rouinmajhi@gmail.com`).
- **Interactive Playground Console**: Test models with streaming SSE, temperature tuning, and real-time latency and failover telemetry.

---

## 3. Environment Variables & Setup Guide

### Required Environment Variables

Create a `.env` file in the project root:

```env
# Gemini API Key (Required for resilient zero-downtime fallback engine)
GEMINI_API_KEY="your-gemini-api-key"

# Port (Defaults to 3000)
PORT=3000

# App URL (Current domain URL for self-referential cURL snippets)
APP_URL="https://your-domain.com"

# Admin Email (Defaults to designated admin)
ADMIN_EMAIL="rouinmajhi@gmail.com"
```

### Local Development Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Firebase**:
   Ensure `firebase-applet-config.json` is configured in the project root:
   ```json
   {
     "projectId": "your-firebase-project",
     "appId": "1:xxx:web:xxx",
     "apiKey": "AIzaSy...",
     "authDomain": "your-firebase-project.firebaseapp.com",
     "firestoreDatabaseId": "your-database-id"
   }
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   The gateway runs on `http://localhost:3000` with both React frontend and Express API routes active simultaneously.

4. **Production Build & Execution**:
   ```bash
   npm run build
   npm start
   ```

---

## 4. API Reference Manual

NexusGate provides standard OpenAI v1 endpoints:

### 1. `POST /v1/chat/completions`

Sends a chat completion request with automatic multi-key rotation and failover.

#### Headers
| Header | Type | Description |
|---|---|---|
| `Authorization` | `string` | **Required**. `Bearer sk-gateway-...` |
| `Content-Type` | `string` | `application/json` |

#### Request Body
```json
{
  "model": "llama-3.3-70b-versatile",
  "messages": [
    { "role": "system", "content": "You are a concise AI assistant." },
    { "role": "user", "content": "Explain quantum computing in two sentences." }
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": false
}
```

#### Successful JSON Response (Non-Streaming)
```json
{
  "id": "chatcmpl-87df2a9b-381c",
  "object": "chat.completion",
  "created": 1731250800,
  "model": "llama-3.3-70b-versatile",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Quantum computing utilizes qubits that can exist in multiple states simultaneously via superposition. This allows it to solve specific complex computational problems exponentially faster than classical computers."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 28,
    "completion_tokens": 34,
    "total_tokens": 62
  },
  "gateway_meta": {
    "provider_used": "groq",
    "failover_count": 0,
    "latency_ms": 142,
    "cost_usd": 0.000049
  }
}
```

#### Streaming Response (`stream: true`)
Server-Sent Events (SSE) format:
```
data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Quantum"}}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" computing"}}]}

data: [DONE]
```

---

### 2. `GET /v1/models`

Lists all dynamically discovered models available across the active key pool.

#### Response
```json
{
  "object": "list",
  "data": [
    {
      "id": "llama-3.3-70b-versatile",
      "object": "model",
      "created": 1731164400,
      "owned_by": "groq"
    },
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1731164400,
      "owned_by": "openai"
    },
    {
      "id": "gemini-2.0-flash",
      "object": "model",
      "created": 1731164400,
      "owned_by": "gemini"
    }
  ]
}
```

---

## 5. Integration Code Snippets

### Python (Official OpenAI Library)

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-domain.com/v1",
    api_key="sk-gateway-live-your_key_here"
)

response = client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the speed of light?"}
    ]
)

print(response.choices[0].message.content)
```

### Node.js / TypeScript

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://your-domain.com/v1',
  apiKey: 'sk-gateway-live-your_key_here',
});

async function run() {
  const stream = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: 'Say hello!' }],
    stream: true,
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
}

run();
```

---

## 6. Admin Guide: Bulk Ingestion & Key Rotation

1. Navigate to `/admin` or click **Admin Panel** in the top navigation.
2. Ensure you are signed in with the designated admin Google account (`rouinmajhi@gmail.com`).
3. Click **Add Provider Keys (Bulk)**.
4. Select the provider (or leave on **Auto-Detect by Prefix**):
   - `gsk_...` ➔ Groq
   - `sk-...` / `sk-proj-...` ➔ OpenAI
   - `AIzaSy...` ➔ Google Gemini
   - `sk-or-...` ➔ OpenRouter
   - `csk-...` ➔ Cerebras
5. Paste your keys (one per line).
6. Click **Append Keys to Master Pool**.
7. The gateway immediately pings `/v1/models` with each key, registers discoverable models, and adds the keys to the active rotation queue.
8. If a key hits a 429 rate limit during live traffic, the router places it in a 60-second cooldown and routes subsequent requests to the next active key.

---

## 7. Deployment Guide

### Deploying to Render
1. Create a **Web Service** on Render connected to this repository.
2. Build Command: `npm install && npm run build`
3. Start Command: `npm start`
4. Set Environment Variables: `GEMINI_API_KEY`, `PORT=3000`.

### Deploying to Vercel
1. Import repository into Vercel.
2. Framework Preset: **Vite**.
3. Build Command: `npm run build`.
4. Output Directory: `dist`.

### Deploying to Google Cloud Run / Firebase
1. Provision Firestore and Auth via Google Cloud Console.
2. Deploy the Node container using `gcloud run deploy`.

---

## License
Apache-2.0
