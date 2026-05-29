# Search Re-Ranker UI

React + Vite dashboard for comparing the baseline Amazon-style product order with the ML re-ranked order returned by the FastAPI backend.

## Run

```powershell
npm install
npm run dev
```

The dev server proxies `/api/*` to `http://localhost:8000`, so start the backend first:

```powershell
uvicorn api.main:app --reload --port 8000
```

## Main Files

- `src/App.jsx` - dashboard logic and ranking comparison UI
- `src/App.css` / `src/index.css` - styling
- `vite.config.js` - React, Tailwind, and backend proxy config
