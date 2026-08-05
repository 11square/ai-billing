# AI Bill

A full-stack billing, inventory and point-of-sale application for small businesses. The
frontend is a responsive single-page application served by an Express API, with
MySQL persistence through Sequelize.

## Features

- Authentication and role-aware staff access
- Dashboard and sales summaries
- POS billing and invoice generation
- Grocery and fertilizer product modules
- Menu, stock and purchase order management
- Vendor master data, payable balances, purchase ledger, payments, debit notes and credit adjustments
- Raw-material inventory, stock movements, low-stock alerts, weighted cost, recipe linking and production consumption
- Customer credit tracking
- Staff and attendance management
- Scheduled and on-demand reports
- Voice-assisted billing

## Project structure

```text
backend_billing/
|-- app.js                  Express application composition
|-- server.js               Database connection and process lifecycle
|-- config/                 Environment and database configuration
|-- middleware/             Authentication and error handling
|-- models/                 Sequelize domain models
|-- routes/                 Central registry and feature API endpoints
|-- services/               Background and reporting services
|-- public/
|   |-- index.html          SPA shell
|   |-- css/                Application styles
|   `-- js/                 Frontend feature modules
|-- init.sql                Initial database schema
|-- seed.js                 Base development seed
`-- seed-demo.js            Optional demonstration data
```

## Local setup

1. Install Node.js 18+ and MySQL 8+.
2. Copy `.env.example` to `.env` and update the database credentials.
3. Create the database named by `DB_NAME`.
4. Run `npm install`.
5. Optionally run `npm run seed:demo` for sample data.
6. Start development mode with `npm run dev`.
7. Open `http://localhost:3000`.

Use `DB_SYNC_ALTER=true` only during an intentional schema migration. It is
disabled by default to prevent automatic table alterations at startup.

## Commands

- `npm start` - start the server
- `npm run dev` - start with automatic reload
- `npm run check` - run JavaScript syntax checks
- `npm run seed` - seed base data
- `npm run seed:demo` - seed demonstration data

All endpoints are mounted below `/api`. Use `GET /api/health` for a service
check. Protected endpoints expect `Authorization: Bearer <token>`. Login tokens
remain valid until the user signs out manually.
