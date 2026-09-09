# Currency Converter Web App

A full-stack currency conversion application built with Node.js + Express on the backend and React + Tailwind CSS on the frontend. It supports:

- Dual currency converter with side-by-side source/target selectors
- Live exchange rates from the ExchangeRate API
- 30-day historical rate trend analysis
- SQLite-backed local persistence for conversion history and favorites
- Regional and major currency support
- Favorites list for quick repeated lookups

## Tech Stack

- Backend: Node.js, Express, SQLite3
- Frontend: React, Vite, Tailwind CSS, Recharts
- API: ExchangeRate API

## Project Structure

- `backend/` – Express server, SQLite database, API routes
- `frontend/` – React frontend with Tailwind styling
- `package.json` – root workspace scripts

## Required Setup from Your Side

Before running the app, you need to create a valid ExchangeRate API key.

1. Sign up at https://www.exchangerate-api.com/
2. Copy `backend/.env.example` to `backend/.env`
3. Add your API key:

   EXCHANGE_RATE_API_KEY=your_api_key_here
   PORT=5000

4. Copy `frontend/.env.example` to `frontend/.env` if you want to customize the frontend API URL:

   VITE_API_URL=http://localhost:5000

> Without the ExchangeRate API key, the live conversion endpoints will return an error and the app cannot fetch fresh conversion data.

## Installation

From the root of the project:

```bash
npm install
```

## Run the App

### Development mode

```bash
npm run dev
```

This starts:

- Backend: http://localhost:5000
- Frontend: http://localhost:5173

### Production build

```bash
npm run build
```

Then start only the backend:

```bash
npm run start
```

## Features Included

- Live exchange rate conversion using ExchangeRate API
- Historical trend chart for the last 30 days
- SQLite caching of recent conversions and favorites
- Responsive UI with Tailwind CSS
- Currency favorites for quicker access

## Notes

- The app stores recent conversion history and favorites locally in `backend/currency_app.db`
- The SQLite database is created automatically when the backend starts
- If you do not provide a valid API key, the app will still run, but live conversion and historical endpoints will be unavailable until you add one
