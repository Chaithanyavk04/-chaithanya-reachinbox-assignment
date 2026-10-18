# ReachInbox Assignment

An email scheduling application built with React, TypeScript, Node.js, Express, PostgreSQL, Redis, BullMQ, and Elasticsearch.

## Features

- Google OAuth authentication and protected API routes
- Email scheduling and background job processing
- PostgreSQL persistence for email records
- Redis and BullMQ queue management
- Retry handling with exponential backoff
- Email rate limiting and delayed job handling
- Elasticsearch-backed email search
- Settings API
- SMTP integration using Nodemailer
- Optional Slack notifications

## Technology Stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL
- **Queue:** Redis, BullMQ
- **Search:** Elasticsearch
- **Email:** Nodemailer, SMTP
- **Authentication:** Google OAuth

## Project Structure

- `backend/` — API, authentication, database integration, and email worker
- `frontend/` — React application
- `infra/` — Infrastructure configuration
- `.gitignore` — Excludes environment files, dependencies, and build artifacts

## Prerequisites

- Node.js and npm
- Docker Desktop
- Google OAuth credentials
- SMTP credentials for email testing

## Setup

1. Start Docker Desktop.
2. Start the infrastructure services using the Docker Compose configuration in `infra/`.
3. Configure the required environment variables in `backend/.env` and any frontend environment file required by the project.
4. Install dependencies in the backend and frontend directories using `npm install`.
5. Run the database migration from the backend directory using `npm run migrate`.
6. Start the backend API and email worker using the existing npm scripts.
7. Start the frontend development server.

Use the existing project scripts and configure OAuth callback URLs and environment variables according to your local setup.

## Local Development

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- Health check: `http://localhost:3000/health`

## Verification

The backend and frontend production builds completed successfully during development. Authentication, protected API access, email idempotency, email search, and SMTP connectivity were also tested.

## Email Testing

The project supports SMTP testing with Ethereal. Ethereal provides preview links for test messages and does not deliver those messages to real recipient inboxes.

## Security

- Never commit `.env` files or credentials.
- Keep OAuth secrets, SMTP passwords, session secrets, and webhook URLs private.
- Use HTTPS and appropriate secure-cookie settings for production deployments.

## Limitations

Production deployment and every failure-recovery scenario have not been fully verified.