# Nandibaag Bot

A full-stack WhatsApp bot for Nandibaag Resort management with AI-powered customer service and real-time monitoring dashboard.

## Tech Stack

### Backend
- **Node.js** - Runtime environment
- **Express** - Web framework
- **MongoDB** + **Mongoose** - Database
- **Socket.io** - Real-time WebSocket communication
- **whatsapp-web.js** - WhatsApp integration
- **OpenAI SDK** - AI integration via OpenRouter
- **Winston** - Logging
- **PM2** - Process management (production)

### Frontend
- **React** - UI framework
- **Vite** - Build tool
- **TailwindCSS v4** - Styling
- **React Router** - Navigation
- **Socket.io Client** - Real-time updates
- **Axios** - HTTP client
- **Lucide React** - Icons
- **vite-plugin-pwa** - Progressive Web App support

## Project Structure

```
nandibaag-bot/
├── backend/
│   ├── src/
│   │   ├── config/          # Configuration files (env, db, logger)
│   │   ├── models/          # Mongoose models
│   │   ├── services/        # Business logic services
│   │   ├── routes/          # API routes
│   │   ├── middleware/      # Express middleware
│   │   ├── sockets/         # Socket.io handlers
│   │   ├── utils/           # Utility functions
│   │   └── server.js        # Entry point
│   ├── sessions/            # WhatsApp auth data (gitignored)
│   ├── logs/                # Application logs (gitignored)
│   ├── .env.example         # Environment variables template
│   ├── .gitignore
│   ├── package.json
│   └── ecosystem.config.js  # PM2 configuration
├── frontend/
│   ├── src/
│   │   ├── pages/           # Page components
│   │   ├── components/      # Reusable components
│   │   ├── context/         # React context providers
│   │   ├── hooks/           # Custom React hooks
│   │   ├── utils/           # Utility functions
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── public/
│   │   ├── manifest.json
│   │   └── icons/
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
└── README.md
```

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- MongoDB (local or cloud instance)
- OpenRouter API key

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file from the example:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
- Set your MongoDB connection URI
- Add your OpenRouter API key
- Configure JWT secret and expiration
- Set resort contact numbers
- Update admin credentials

5. Start the development server:
```bash
npm run dev
```

The backend will start on port 3000 (default).

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The frontend will start on port 5173.

### Production Deployment

#### Backend with PM2
```bash
cd backend
npm install
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

#### Frontend
```bash
cd frontend
npm install
npm run build
# Serve the dist/ folder with your preferred web server
```

## Environment Variables

See `backend/.env.example` for all required environment variables with descriptions.

## Features

- WhatsApp bot integration for customer inquiries
- AI-powered responses using OpenRouter models
- Real-time dashboard for monitoring bot activity
- Admin authentication and management
- Follow-up message scheduling
- Comprehensive logging and error handling

## Development Notes

- The `sessions/` directory contains WhatsApp authentication data and is gitignored
- The `logs/` directory contains application logs and is gitignored
- Environment validation runs at startup - the server will exit if required variables are missing
- MongoDB connection retries up to 10 times with 5-second intervals before exiting

## License

ISC
