# BlackOps Reminder

## Overview
BlackOps Reminder is a minimal, dark-themed daily reminder and schedule management system. It's a full-stack TypeScript application designed to help users create, edit, and track tasks with priority levels and completion status. Key capabilities include a React frontend with weekly/monthly calendar views, natural language task input parsing, Google Calendar integration, and a comprehensive finance tracking module. The system aims to provide proactive insights and autonomous agent capabilities for task management, portfolio analysis, and even radio scheduling.

## User Preferences
- Preferred communication style: Simple, everyday language.
- **Code changes**: Always show preview before applying. Never apply changes automatically. User must approve with "Aplicar" button. Must have undo/rollback option available.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **UI Components**: shadcn/ui built on Radix UI, styled with Tailwind CSS v4 (forced dark mode)
- **Animations**: Framer Motion
- **Build Tool**: Vite

### Backend
- **Runtime**: Node.js with Express
- **Language**: TypeScript
- **API Pattern**: RESTful endpoints
- **Database ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Validation**: Zod

### Data Storage
- **Database**: PostgreSQL (managed via Drizzle ORM)
- **Core Tables**: `users`, `tasks`, `weekly_summaries`, `investments`, `transactions`, `watchlist_items`, `price_alerts`, `telegram_config`, `projects`, `djs`.

### Core Features & Design Decisions
1.  **Monorepo Structure**: `client/`, `server/`, `shared/` for organized development.
2.  **Natural Language Parsing**: Supports English and Spanish for task input, recurring patterns, and priority keywords.
3.  **Push Notifications**: Web-push for browser notifications and Telegram bot integration for reminders and interactive chat.
4.  **Autonomous Agents**:
    *   **Radio Agent**: Manages Black Room Radio DJ scheduling, analyzing Google Calendar for empty slots, generating messages, and importing DJs.
    *   **Portfolio Agent**: Provides portfolio summary, rebalancing analysis, opportunity detection, and weekly reports.
    *   **Code Agent**: Allows natural language code generation for CRUD operations, trackers, and forms with file system interaction, backups, and database schema management.
    *   **GitHub Agent**: Connects to user's GitHub repositories, allows browsing files, and making AI-powered edits with automatic commits.
5.  **Proactive Insights System**: AI-powered analysis for goals/portfolio alignment, weekly task completion, and event preparation, delivered via prioritized notifications.
6.  **AI Assistant Investment Management**: Gemini 2.5 Flash enables natural language commands to add, update, or delete investments, supporting multiple investment types.
7.  **AI Image Analysis**: Gemini's multimodal capabilities are used to analyze broker screenshots for automatic portfolio import and updates, including gain/loss calculation.
8.  **Scheduled Reminders**: Automated morning, evening, daily market, and weekly reminders delivered via push notifications and Telegram.

## External Dependencies

### Database
-   **PostgreSQL**: Primary data store.
-   **Drizzle Kit**: For database schema migrations.

### Third-Party Services
-   **Google Calendar API**: For calendar synchronization via Replit Connectors (OAuth2).
-   **GitHub API**: For repository browsing and file editing via Replit Connectors (OAuth2).
-   **Telegram Bot API**: For notifications and interactive chat via `@ChatManzanilla_bot`.
-   **Google Gemini API**: For natural language processing, code generation, and multimodal image analysis (Gemini 2.5 Flash).
-   **FINNHUB API**: (Optional, for finance news) Requires `FINNHUB_API_KEY`.

### Key NPM Packages
-   `express`
-   `drizzle-orm`, `drizzle-kit`
-   `@tanstack/react-query`
-   `react-day-picker`
-   `date-fns`
-   `framer-motion`
-   `zod`
-   `googleapis` (for Google Calendar integration)
-   `web-push`