# EventShevent

EventShevent is a web-based campus event and venue management system. It is designed for a college environment where students can request events, administrators can review event proposals, and a master user can manage account approvals and user access.

## Features

- Student registration and login
- Master approval for new student and administrator accounts
- Role-based dashboards for students, administrators, and master control
- Event request form with venue, date, time, description, remarks, and optional images
- Venue selection for floor-wise rooms, ground floor spaces, and campus grounds
- Administrator workflow for approving or rejecting event requests
- Student event registration, unjoin, upvote, and downvote actions
- Requested, applied, and past event views
- Master controls for password changes, role changes, restrictions, blocking, and account deletion
- Light and dark mode

## Tech Stack

- HTML
- CSS
- JavaScript
- Node.js
- Vercel Serverless Functions

## Running Locally

```bash
npm start
```

Open the application at:

```text
http://localhost:3000
```

## Master Account

```text
Email: trijitdas2005@gmail.com
Password: trijit007
```

## Deployment

The project includes Vercel API route files inside the `api` folder, so it can be deployed as a Vercel project.

Recommended Vercel settings:

```text
Framework Preset: Other
Build Command: leave empty
Output Directory: leave empty
Install Command: npm install
```

## Data Storage

For local development, application data is stored in `data/db.json`. This file is ignored by Git because it may contain account details, uploaded ID-card images, and event images.

On Vercel's free serverless environment, runtime data is temporary and may reset after redeploys or cold starts. For a production-ready version, the data layer should be moved to a hosted database and image uploads should be moved to cloud storage.

## Future Scope

- Permanent cloud database integration
- Password hashing and stronger authentication
- Cloud image storage
- Email notifications for approval updates
- QR-based attendance tracking
- Analytics dashboard for event participation
