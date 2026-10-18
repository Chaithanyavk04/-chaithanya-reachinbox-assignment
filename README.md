# ReachInbox — Email Scheduling Platform

ReachInbox is an email scheduling application that combines a React frontend, a TypeScript/Express backend, PostgreSQL persistence, Redis-backed background jobs, and Elasticsearch-powered search. It supports scheduled email processing, configurable sending limits, retry handling, Google OAuth authentication, and optional Slack notifications.

## Features

- **Authentication:** Google OAuth login and protected API routes.
- **Email scheduling:** Schedule email jobs for future processing.
- **Persistent storage:** Store email records in PostgreSQL.
- **Background processing:** Use Redis and BullMQ to manage scheduled jobs.
- **Retry handling:** Configure job retries with exponential backoff.
- **Rate limiting:** Configure global and per-sender sending limits and minimum send delays.
- **Email testing:** Use Nodemailer with an SMTP provider such as Ethereal.
- **Search:** Elasticsearch integration for email search.
- **Queue monitoring:** Bull Board integration for monitoring BullMQ queues.
- **Settings:** Configure application sending limits.
- **Slack integration:** Connect and disconnect Slack and support notifications for relevant events.

## Technology Stack

| Component | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL |
| Queue and cache | Redis, BullMQ |
| Search | Elasticsearch |
| Queue monitoring | Bull Board |
| Email | Nodemailer, SMTP |
| Authentication | Google OAuth, Express sessions |
| Infrastructure | Docker Compose |

## Project Structure

```text
-chaithanya-reachinbox-assignment/
├── backend/
│   ├── migrations/
│   │   ├── 001_create_emails.js
│   │   └── 002_create_slack_connections.js
│   ├── src/
│   │   ├── server.ts
│   │   ├── worker.ts
│   │   └── slackRoutes.ts
│   ├── package.json
│   └── .env
├── frontend/
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
├── infra/
│   └── docker-compose.yml
├── .gitignore
└── README.md
```

The structure above highlights the main application components; additional source files may exist in each directory.

## Prerequisites

Install the following before starting the project:

- Node.js and npm
- Docker Desktop with Docker Compose
- Google OAuth credentials
- SMTP credentials for email testing
- Slack app credentials if Slack integration is required

## Installation and Setup

### 1. Clone the repository

```bash
git clone https://github.com/Chaithanyavk04/-chaithanya-reachinbox-assignment.git
cd -chaithanya-reachinbox-assignment
```

### 2. Start infrastructure services

Ensure Docker Desktop is running, then execute:

```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps
```

The Compose configuration starts the supporting infrastructure, including PostgreSQL, Redis, and Elasticsearch.

### 3. Configure backend environment variables

Create `backend/.env` and configure the required values for your environment.

Variable names used by the application include:

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

Fill in the values required by your local configuration. Do not commit real credentials or secrets to GitHub.

Configure the Google OAuth redirect URI to match the callback URL used by the backend. Configure the Slack app redirect URL to match the Slack callback route.

### 4. Install backend dependencies

Open a terminal in the backend directory:

```bash
cd backend
npm install
```

Run the database migrations:

```bash
npm run migrate
```

The migrations create the email and Slack connection tables.

### 5. Install frontend dependencies

Open another terminal:

```bash
cd frontend
npm install
```

Ensure the frontend's API configuration points to the backend at `http://localhost:3000` for local development.

## Running the Application

Keep each process running in its own terminal.

**Terminal 1 — Infrastructure**

From the project root:

```bash
docker compose -f infra/docker-compose.yml up -d
```

**Terminal 2 — Backend API**

```bash
cd backend
npm run dev
```

**Terminal 3 — Email worker**

```bash
cd backend
npm run worker
```

**Terminal 4 — Frontend**

```bash
cd frontend
npm run dev
```

Open the frontend at:

- Frontend: http://localhost:5173
- Backend health check: http://localhost:3000/health

The health endpoint can be used to verify that the backend is responding. Authentication and integration features require the relevant credentials and configuration.

## Email Testing

The application supports SMTP testing through Nodemailer. Ethereal is useful for development because it provides preview links for test messages rather than delivering them to real recipient inboxes.

Use test recipients and inspect the resulting preview links when verifying email processing.

## Queue Processing and Reliability

BullMQ uses Redis to manage background email jobs. The backend worker processes scheduled jobs and is configured to retry failed jobs with exponential backoff.

The application also includes sending-limit configuration and delayed job handling. Actual rate-limit behavior, recovery after restarts, and delivery behavior should be verified in the running environment before relying on them in production.

## Authentication and Integrations

### Google OAuth

Configure a Google OAuth client and set the client ID, client secret, and callback URL in the backend environment. The configured redirect URI must match the URI registered in Google Cloud Console.

### Slack

Configure a Slack app with the appropriate OAuth redirect URL and permissions. The application provides Slack connection status and connect/disconnect functionality.

Notifications depend on valid OAuth credentials, granted permissions, and correct Slack message destination handling.

### Elasticsearch and Bull Board

Elasticsearch is included for email search. Bull Board is included for queue monitoring. Both require the associated services to be running and the application routes to be configured correctly.

## Build and Verification

Build the backend:

```bash
cd backend
npm run build
```

Build the frontend:

```bash
cd frontend
npm run build
```

Both production builds completed successfully during development.

The backend and frontend also support these scripts:

- Backend: `npm run dev`, `npm run start`, `npm run migrate`, `npm run worker`
- Frontend: `npm run dev`, `npm run build`, `npm run preview`, `npm run lint`

The backend's default `npm test` script is a placeholder; it does not run an automated test suite.

## Security Considerations

- Never commit `.env` files, OAuth secrets, SMTP passwords, or session secrets.
- Restrict access to the database, Redis, Elasticsearch, and queue monitoring interface.
- Use HTTPS and appropriate secure-cookie settings for production deployments.
- Use appropriately scoped OAuth permissions and protect authenticated routes.
- Keep development credentials separate from production credentials.

## Known Limitations

- Production deployment has not been documented as completed.
- All failure-recovery and rate-limit scenarios have not been fully verified.
- SMTP preview testing does not demonstrate delivery to a real recipient.
- Automated test coverage should be added beyond the current placeholder test script.

## License

No project-specific open-source license has been specified.
