# API Service Documentation

This document outlines the current setup and key components of the `apps/api` service.

## Technologies Used:

*   **Fastify:** Web framework.
*   **TypeScript:** Programming language.
*   **Drizzle ORM:** ORM for database interactions.
*   **PostgreSQL:** Database (provisioned via Pulumi in the `infra` directory).

## Drizzle ORM Setup:

*   **`drizzle.config.ts`:** Configuration file for Drizzle Kit, pointing to the schema and migration output directory.
*   **`src/db/schema.ts`:** Defines the database schema using Drizzle ORM, including tables for `users`, `courses`, `videos`, and `transcripts`.

## Current Status:

*   Drizzle ORM and its dependencies are installed.
*   `drizzle.config.ts` is configured.
*   The database schema is defined in `src/db/schema.ts`.
*   The PostgreSQL database instance is provisioned and accessible.
*   Docker setup for development environment is configured (Dockerfile and docker-compose.yml).

## Next Steps:

*   Generate and apply Drizzle migrations to the PostgreSQL database.
*   Implement database connection and query logic using Drizzle ORM.

## API Routes

### Creator Portal

*   **Authentication**
    *   `POST /api/creators/register` - Register a new creator account.
    *   `POST /api/creators/login` - Login for creators.
*   **Course Management**
    *   `POST /api/courses` - Create a new course.
    *   `PUT /api/courses/:courseId` - Update a course.
    *   `GET /api/courses/:courseId` - Get course details.
    *   `GET /api/creators/courses` - Get all courses for a creator.
    *   `POST /api/courses/:courseId/videos` - Upload a video to a course.
*   **Dashboard**
    *   `GET /api/creators/dashboard` - Get sales data and student enrollment.

### Student Portal

*   **Authentication**
    *   `POST /api/students/register` - Register a new student account.
    *   `POST /api/students/login` - Login for students.
*   **Course Discovery**
    *   `GET /api/courses` - Get all available courses.
    *   `GET /api/courses/:courseId` - Get details for a specific course.
*   **Payment**
    *   `POST /api/courses/:courseId/purchase` - Purchase a course.
*   **Video Player**
    *   `GET /api/courses/:courseId/videos` - Get all videos for a purchased course.

### AI Assistant

*   `POST /api/ai/ask` - Ask a question about a video.
    *   Request Body: `{ "videoId": "...", "question": "..." }`
    *   Response: `{ "answer": "..." }`
