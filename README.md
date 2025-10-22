# 🚀 Ohkay Server

A self-hosted Discord alternative built with Node.js, TypeScript, Socket.io, and PostgreSQL. Connect to servers via IP and password for complete control over your communication platform.

## ✨ Features

- **Real-time Communication**: WebSocket-based messaging using Socket.io
- **Channel System**: Create and manage multiple text channels
- **Private Messaging**: Send direct messages between users
- **Authentication**: Secure JWT-based authentication with server password protection
- **Self-Hosted**: Full control over your data and infrastructure
- **Docker Ready**: Simple deployment with Docker Compose
- **Comprehensive Logging**: Winston logger with file rotation and multiple log levels
- **Production Ready**: Health checks, rate limiting, and security middleware

## 🏗️ Architecture

- **Backend**: Node.js with TypeScript
- **Real-time**: Socket.io for WebSocket communication
- **API**: Express.js REST API
- **Database**: PostgreSQL
- **Logging**: Winston with daily log rotation
- **Containerization**: Docker & Docker Compose

## 📋 Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- PostgreSQL 16+ (if not using Docker)

**📌 AlmaLinux 9 Users**: See [ALMALINUX_SETUP.md](./ALMALINUX_SETUP.md) for complete installation guide

## 🚀 Quick Start with Docker

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd ohkay-server
```

### 2. Configure environment variables

Copy the example environment file and edit it:

```bash
cp .env.example .env
```

Edit `.env` and set your secure values:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_NAME=ohkay
DB_USER=ohkay_user
DB_PASSWORD=your_secure_database_password_here

# Security
JWT_SECRET=your_very_secure_random_jwt_secret_here
SERVER_PASSWORD=your_server_access_password

# Logging
LOG_LEVEL=info
LOG_DIR=./logs
```

⚠️ **Important**: Change all default passwords and secrets before deploying!

### 3. Build and start the services

```bash
npm run docker:build
npm run docker:up
```

This will:
- Build the Docker image for the application
- Start PostgreSQL database
- Start the Ohkay server
- Initialize the database schema
- Create log volumes for persistence

### 4. Verify the deployment

Check that the server is running:

```bash
curl http://localhost:3000/health
```

You should see: `{"status":"ok","timestamp":"..."}`

### 5. View logs

```bash
npm run docker:logs
```

Or check the logs directory:
- `./logs/application-YYYY-MM-DD.log` - All application logs
- `./logs/error-YYYY-MM-DD.log` - Error logs only

## 🛠️ Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Setup local PostgreSQL

Create a database and user:

```sql
CREATE DATABASE ohkay;
CREATE USER ohkay_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE ohkay TO ohkay_user;
```

Run the initialization script:

```bash
psql -U ohkay_user -d ohkay -f init.sql
```

### 3. Configure environment

Create a `.env` file with local settings:

```env
PORT=3000
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ohkay
DB_USER=ohkay_user
DB_PASSWORD=your_password
JWT_SECRET=dev_secret
SERVER_PASSWORD=dev_password
LOG_LEVEL=debug
LOG_DIR=./logs
```

### 4. Run in development mode

```bash
npm run dev
```

### 5. Build for production

```bash
npm run build
npm start
```

## 🔌 API Endpoints

### Authentication

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "john_doe",
  "password": "secure_password",
  "serverPassword": "your_server_password",
  "displayName": "John Doe"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "john_doe",
  "password": "secure_password",
  "serverPassword": "your_server_password"
}
```

### Channels

#### Get All Channels
```http
GET /api/channels
Authorization: Bearer <jwt_token>
```

#### Create Channel
```http
POST /api/channels
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "name": "general",
  "description": "General discussion",
  "isPrivate": false
}
```

#### Get Channel Messages
```http
GET /api/channels/:channelId/messages?limit=50
Authorization: Bearer <jwt_token>
```

## 🔌 WebSocket Events

### Client → Server

- `join_channel` - Join a channel room
  ```javascript
  socket.emit('join_channel', channelId);
  ```

- `leave_channel` - Leave a channel room
  ```javascript
  socket.emit('leave_channel', channelId);
  ```

- `send_message` - Send a message to a channel
  ```javascript
  socket.emit('send_message', { channelId, content });
  ```

- `send_private_message` - Send a private message
  ```javascript
  socket.emit('send_private_message', { recipientId, content });
  ```

- `typing` - Indicate user is typing
  ```javascript
  socket.emit('typing', channelId);
  ```

### Server → Client

- `joined_channel` - Confirmation of joining a channel
- `user_joined` - Another user joined the channel
- `user_left` - A user left the channel
- `new_message` - New message in a channel
- `new_private_message` - New private message received
- `user_typing` - Another user is typing
- `error` - Error message

## 📊 Logging

Logs are stored in the `./logs` directory:

- **Console**: Colored output for development
- **application-YYYY-MM-DD.log**: All info and above logs
- **error-YYYY-MM-DD.log**: Error logs only
- **Rotation**: Logs are rotated daily and compressed
- **Retention**: Application logs kept for 14 days, errors for 30 days

Log levels: `error`, `warn`, `info`, `debug`

Change log level via `LOG_LEVEL` environment variable.

## 🐳 Docker Commands

```bash
# Build the Docker image
npm run docker:build

# Start services in detached mode
npm run docker:up

# Stop all services
npm run docker:down

# View logs (follow mode)
npm run docker:logs

# Rebuild and restart
npm run docker:down && npm run docker:build && npm run docker:up
```

## 🔧 Troubleshooting

### Database connection issues

Check PostgreSQL is running:
```bash
docker-compose ps
```

View PostgreSQL logs:
```bash
docker-compose logs postgres
```

### Application won't start

1. Check the logs:
   ```bash
   docker-compose logs app
   ```

2. Verify environment variables are set correctly

3. Ensure PostgreSQL is healthy before app starts

### Port already in use

Change the port mapping in `docker-compose.yml`:
```yaml
ports:
  - "3001:3000"  # External:Internal
```

## 🔒 Security Considerations

1. **Change default passwords**: Never use default values in production
2. **Use strong JWT secrets**: Generate random strings (32+ characters)
3. **HTTPS**: Use a reverse proxy (nginx, Caddy) with SSL/TLS
4. **Firewall**: Limit access to your server's IP
5. **Regular updates**: Keep dependencies up to date
6. **Backup database**: Regularly backup PostgreSQL data

## 📁 Project Structure

```
ohkay-server/
├── src/
│   ├── index.ts              # Main application entry
│   ├── routes/
│   │   ├── auth.ts           # Authentication routes
│   │   └── channels.ts       # Channel management routes
│   ├── socket/
│   │   └── handlers.ts       # WebSocket event handlers
│   └── utils/
│       ├── auth.ts           # Authentication utilities
│       ├── database.ts       # Database connection pool
│       └── logger.ts         # Winston logger configuration
├── logs/                     # Application logs (created at runtime)
├── Dockerfile                # Multi-stage Docker build
├── docker-compose.yml        # Docker Compose configuration
├── init.sql                  # Database initialization script
├── package.json              # Node.js dependencies
├── tsconfig.json             # TypeScript configuration
└── .env.example              # Example environment variables
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

MIT License - See LICENSE file for details

## 🔮 Roadmap

- [ ] Voice channels
- [ ] File uploads and sharing
- [ ] User roles and permissions
- [ ] Server discovery system
- [ ] End-to-end encryption for private messages
- [ ] Mobile app support
- [ ] Desktop app (Electron)

## 💬 Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

Made with ❤️ for the self-hosting community
