# ReachInbox — Email Scheduling Platform

ReachInbox is a full-stack email scheduling application built with React, TypeScript, Express, PostgreSQL, Redis, BullMQ, and Elasticsearch. It supports scheduling emails, processing jobs asynchronously, tracking email status, configuring sending limits, and integrating Google OAuth and Slack.

## 1. Technology Stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL
- **Job queue:** Redis and BullMQ
- **Search:** Elasticsearch
- **Queue monitoring:** Bull Board
- **Email:** Nodemailer and SMTP
- **Authentication:** Google OAuth and Express sessions
- **Notifications:** Slack OAuth integration

## 2. Project Structure

```text
.
├── backend/
│   ├── migrations/
│   │   ├── 001_create_emails.js
│   │   └── 002_create_slack_connections.js
│   ├── src/
│   │   ├── server.ts
│   │   ├── worker.ts
│   │   ├── rateLimiter.ts
│   │   └── slackRoutes.ts
│   └── package.json
├── frontend/
│   ├── src/
│   └── package.json
├── infra/
│   └── docker-compose.yml
└── README.md
```

## 3. Prerequisites

Install Node.js, npm, and Docker Desktop with Docker Compose.

The following credentials are needed for the corresponding integrations:

- Google OAuth client credentials
- Ethereal SMTP credentials or another compatible SMTP provider
- Slack app credentials if Slack notifications are required

## 4. Environment Configuration

Create `backend/.env` and configure the following variables with values appropriate for your environment.

```dotenv
PORT=3000
DATABASE_URL=
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
ELASTICSEARCH_URL=http://localhost:9200

SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASS=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=

SESSION_SECRET=
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=

EMAIL_RATE_LIMIT=
EMAIL_SENDER_RATE_LIMIT=
EMAIL_RATE_WINDOW_SECONDS=
WORKER_CONCURRENCY=
MIN_SEND_DELAY_MS=
```

Use the actual values and required formats expected by the application. Do not commit real credentials, tokens, or secrets.

Configure the Google OAuth callback URL in Google Cloud Console to match the backend configuration. Configure the Slack OAuth redirect URL to match the callback route implemented by the application.

## 5. Setup and Execution

### Step 1: Start infrastructure

From the project root:

```powershell
docker compose -f ".\infra\docker-compose.yml" up -d
docker compose -f ".\infra\docker-compose.yml" ps
```

Ensure PostgreSQL, Redis, and Elasticsearch are running.

### Step 2: Install backend dependencies and migrate the database

```powershell
cd backend
npm install
npm.cmd run migrate
```

The migrations create the email and Slack connection tables.

### Step 3: Start the backend API

In a dedicated terminal:

```powershell
cd backend
npm.cmd run dev
```

The backend is configured to run at `http://localhost:3000`.

Check the health endpoint at `http://localhost:3000/health`.

### Step 4: Start the BullMQ worker

In another terminal:

```powershell
cd backend
npm.cmd run worker
```

Keep the worker running to process queued email jobs.

### Step 5: Start the frontend

In another terminal:

```powershell
cd frontend
npm install
npm.cmd run dev
```

Open `http://localhost:5173`.

### Production builds

Backend:

```powershell
cd backend
npm.cmd run build
```

Frontend:

```powershell
cd frontend
npm.cmd run build
```

## 6. Ethereal Email Setup

Ethereal provides a test SMTP service for development. Messages are captured for preview and are not delivered to real recipient inboxes.

1. Visit https://ethereal.email/ and create a test account.
2. Obtain the SMTP hostname, port, username, and password from the account details.
3. Configure the corresponding `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_SECURE` values in `backend/.env`.
4. Restart the backend and worker after changing environment variables.
5. Schedule a test email through the frontend.
6. Inspect the worker output and the Ethereal preview URL, when provided by the implementation.

Use test data during development. Successful job processing and successful SMTP delivery are distinct outcomes.

## 7. Architecture Overview

### Email scheduling

The frontend submits an email scheduling request to the Express backend. The backend persists the email record in PostgreSQL and uses BullMQ with Redis to manage asynchronous email processing.

The worker consumes queued jobs and uses the configured SMTP transport to process email deliveries. Email status is stored in the database so that the frontend can display scheduling and processing results.

### Persistence and restart behavior

PostgreSQL stores the application’s email records. Redis is used by BullMQ to maintain queue and delayed-job state.

A worker restart does not inherently require scheduled jobs to be recreated manually, provided the Redis queue data remains available. Full restart recovery also depends on Redis persistence configuration, database availability, and the job-processing implementation.

The expected behavior is that future scheduled jobs remain available for processing after a worker restart. This scenario should be demonstrated in the supplied video only after it has been verified.

### Rate limiting and send delay

The application provides configurable global and per-sender hourly limits, along with a minimum send delay.

The rate limiter and worker coordinate job processing to enforce configured sending constraints. When a limit is reached, jobs may need to be delayed or rescheduled until sending is permitted.

The exact enforcement behavior depends on the implementation and configuration. Rate-limit recovery and Slack alert delivery should be verified before being described as fully tested.

### Worker concurrency

The `WORKER_CONCURRENCY` environment variable configures the intended worker processing concurrency. This controls how many jobs the worker can process concurrently, subject to the BullMQ worker configuration.

Concurrency is distinct from rate limiting: concurrency controls parallel processing, while rate limits constrain how frequently messages may be sent.

## 8. Implemented Features

### Backend

- Express API with TypeScript
- Google OAuth authentication and protected routes
- PostgreSQL email persistence and database migrations
- BullMQ-based scheduling and asynchronous job processing
- Redis-backed queue management
- Retry handling with exponential backoff
- Global and per-sender rate-limit configuration
- Minimum send delay configuration
- Worker concurrency configuration
- SMTP integration through Nodemailer
- Elasticsearch integration for email search
- Bull Board integration for queue monitoring
- Settings API
- Slack OAuth connection, status, and disconnection routes

### Frontend

- React and TypeScript application
- Google OAuth login flow
- Dashboard for email status tracking
- Email composition and scheduling interface
- Scheduled and sent email views/tables
- Settings for sending limits and delays
- Slack connection and disconnection interface
- Loading, error, and empty-state handling where implemented

## 9. Assumptions and Trade-offs

- Ethereal is used for development email previews rather than production email delivery.
- PostgreSQL stores application records, while Redis/BullMQ manages asynchronous job state.
- The application is configured for local development; production deployment requires additional configuration.
- Google OAuth and Slack functionality depend on valid external app credentials and redirect URLs.
- Automated test coverage is limited; the backend's default `npm test` script is a placeholder.
- Rate-limit enforcement, Slack notifications, and recovery under all failure scenarios require further verification before production use.

## 10. Verification

The backend TypeScript build and frontend production build completed successfully during development.

Build success does not by itself verify all runtime scenarios. The scheduled-email workflow, dashboard status updates, restart persistence, rate-limit behavior, and Slack notification delivery should be demonstrated only to the extent they have been confirmed.

## 11. Security

- Never commit `.env` files or credentials.
- Keep session secrets, OAuth secrets, and SMTP passwords private.
- Restrict access to infrastructure and queue-monitoring interfaces.
- Configure secure cookies and HTTPS for production.
- Use least-privilege OAuth permissions.

## License

No project-specific open-source license has been specified.
