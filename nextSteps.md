# API Service Next Steps

This document outlines the immediate next steps for the `apps/api` service.

## Next Steps:

1.  **Generate and Apply Drizzle Migrations:** Create and apply the necessary database migrations based on the schema in `src/db/schema.ts`.
2.  **Implement Database Connection:** Establish the database connection in the Fastify application.
3.  **Implement API Endpoints:**
    *   **Creator Portal:**
        *   Authentication (Register, Login) - **DONE**
        *   Course Management (Create, Update, Get by ID, Get all for Creator) - **DONE**
        *   Dashboard - **PENDING**
    *   **Student Portal:**
        *   Authentication (Register, Login) - **DONE**
        *   Course Discovery (Get all courses, Get course by ID) - **DONE**
        *   Payment - **PENDING**
    *   **Video Player:** Implement video retrieval endpoints - **PENDING**
4.  **Implement RAG Model:**
    *   Develop the service to handle the RAG pipeline.
    *   Integrate the RAG service with the `/api/ai/ask` endpoint.



### mcp config:

¨¨task manager¨¨:
Change the main, research and fallback models to <model_name>, <model_name> and <model_name> respectively.
Initialize taskmaster-ai in my project
use task-manager-ai to

**Usage**

```
You can now ask your IDE to use any Magic UI component. Here are some examples:

"use magic ui to Add a blur fade text animation"
"Add a grid background"
"Add a vertical marquee of logos"

```
