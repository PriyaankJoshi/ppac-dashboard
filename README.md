# PPAC Petroleum Dashboard

Lightweight full-stack app that scrapes live PPAC data (no database), merges imports/exports + consumption for LPG, Naphtha, and ATF, and visualizes it in a React dashboard.

## Stack

- Backend: Node.js, Express, Puppeteer
- Frontend: React (Vite)
- Charts: Recharts

## Features

- Live scraping from:
  - https://ppac.gov.in/import-export
  - https://ppac.gov.in/consumption/products-wise
- API endpoint: `GET /data?product=LPG`
- Data merge by `product + month`
- In-memory cache (10 minutes)
- Product dropdown (LPG/Naphtha/ATF)
- Line chart (Imports vs Exports vs Consumption)
- Data table
- Loading state, error handling, and manual refresh button

## Run Locally

### 1) Start backend

```bash
cd backend
npm install
npm run start
```

Backend runs on `http://localhost:4000`.

### 2) Start frontend (new terminal)

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

The frontend calls backend API via Vite proxy (`/api/data` -> `http://localhost:4000/data`).

## API

### `GET /data`

Query params:

- `product` (optional): `LPG`, `Naphtha`, `ATF`
- `refresh` (optional): `true` to bypass cache and force fresh scrape

Example:

```bash
http://localhost:4000/data?product=LPG
```

Response shape:

```json
{
  "product": "LPG",
  "fromCache": false,
  "count": 12,
  "data": [
    {
      "product": "LPG",
      "month": "Apr-2023",
      "imports": 123,
      "exports": 12,
      "consumption": 222
    }
  ]
}
```
