# Frontend Standalone Development Guide (Mock Mode)

This mode allows frontend developers to build, test, and iterate on UI components with **zero database connection**, **no Neon Auth configuration**, and **interactive dummy data**.

---

## 🚀 Quick Start for Frontend Developers

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Start the Development Server in Mock Mode
```bash
npm run dev:mock
```
*Alternatively, you can copy `.env.mock` to `.env.local` and run `npm run dev`.*

### 3. Open the App
Visit [http://localhost:3000](http://localhost:3000) in your browser.

---

## ✨ Features Available in Mock Mode

| Feature | Mock Mode Behavior |
| :--- | :--- |
| **Authentication** | Automatically authenticated as `Frontend Developer` (`dev-user-001`). No sign-in wall or session expiration. |
| **Company Profile** | Pre-populated with "Apex Auto Care" data. Saving changes persists in memory during the dev server session. |
| **Assistant Config** | Pre-populated with prompts, greeting, model, and capabilities. Version history & publishing are functional. |
| **3CX Calls Log** | Loaded with realistic call records (status, durations, transcripts). |
| **Google Calendar** | Marked as connected with mock status. |
| **Tasks & Bookings** | Populated with mock tasks and scheduling workflows. |
| **Backend & DB** | Completely bypassed. No PostgreSQL/Neon instance or FastAPI Python backend required. |

---

## 🛠️ Modifying Mock Data

Mock data fixtures and initial state are located in:
- [`frontend/src/mocks/mockData.ts`](file:///frontend/src/mocks/mockData.ts)
- [`frontend/src/mocks/mockStore.ts`](file:///frontend/src/mocks/mockStore.ts)

Feel free to add new fields, mock endpoints, or dummy responses to test edge cases (e.g. empty states, long strings, error simulations).
