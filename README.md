# Form Sahayak 📄✨

Form Sahayak is an intelligent, multilingual chat-based application designed to help users understand, analyze, and fill out complex forms easily. It leverages AI to break down form fields, translate them into local languages, and guide users step-by-step through a conversational interface.

## 🚀 Features

- **Intelligent Form Analysis:** Upload a form (image/pdf) and the AI extracts and explains all the fields.
- **Multilingual Support:** Converses in over 14 Indian languages, including Hinglish, Hindi, Bengali, Tamil, Telugu, Marathi, and more.
- **Voice Interactions:** 
  - **Speech-to-Text (STT):** Speak to the assistant directly using the microphone button (optimized for seamless mobile use).
  - **Text-to-Speech (TTS):** The assistant reads out instructions and explanations aloud.
- **Privacy-First Sharing:** Share your chat explanations securely via unique links or WhatsApp. Sensitive images (like PAN/Aadhaar) are strictly stripped from shared views to protect user privacy.
- **Interactive Wizard UI:** Breaks down long forms into easy-to-follow, step-by-step inputs.
- **Analytics Dashboard:** Tracks usage statistics, form types, and language preferences.
- **Responsive & Modern Design:** A premium, dynamic chat interface that feels intuitive on both desktop and mobile.

## 📂 Project Structure

- **`/backend/`** - Node.js Express server to handle API requests (AI integration, share link generation).
- **`/js/`** - Frontend JavaScript modules:
  - `app.js`: Main application orchestrator.
  - `ai-service.js`: Manages AI conversations and form parsing.
  - `speech-service.js`: Handles STT and TTS logic.
  - `ui-renderer.js`: Manages DOM updates, modals, toasts, and UI states.
  - `chat-db.js`: Local storage for conversation history.
- **`/css/`** - Modular CSS (Design system, components, responsive layout).
- **`index.html`** - Main chat application view.
- **`share.html`** - Read-only view for shared chats.

## 🛠️ Setup & Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- NPM or Yarn

### Running Locally

1. **Navigate to the backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Variables:**
   Create a `.env` file in the `backend` folder and add necessary API keys (e.g., Gemini/AI keys).
   ```env
   PORT=3000
   # Add other necessary keys here
   ```

4. **Start the server:**
   ```bash
   node server.js
   ```

5. **Access the application:**
   Open your browser and navigate to `http://localhost:3000` (or the port you specified).

### Docker Support

A `Dockerfile` is included for easy containerization and deployment.
```bash
docker build -t form-sahayak .
docker run -p 3000:3000 form-sahayak
```

## 📱 Mobile Testing Note

Modern browsers strictly enforce **Secure Contexts (HTTPS)** for microphone access (Speech-to-Text). When testing locally on a mobile device over HTTP (e.g., `http://192.168.x.x:3000`), the microphone will be blocked by the browser. 
**Workarounds for local testing:**
- Use a tunneling service like [ngrok](https://ngrok.com/) to expose your local server over HTTPS.
- In mobile Chrome, navigate to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add your local IP address, and enable the flag.

## 🛡️ Privacy

Form Sahayak is built with strict privacy-first principles to protect users' sensitive data (like PAN, Aadhaar, etc.):

- **No Permanent Storage:** 🔒 Uploaded form images are processed in real-time by the AI and are **never** stored permanently on our servers.
- **7-Day Auto Expiry:** Any chat session data that is saved (for sharing purposes) is automatically set to expire and delete after **7 days**.
- **Secure Sharing:** When users share their chat history to seek help from others, original uploaded form images are strictly stripped from the payload to prevent accidental exposure of sensitive documents.
