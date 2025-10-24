# 🚀 Ohkay Server

A self-hosted Discord alternative built with Node.js, TypeScript, Socket.io, and PostgreSQL. Multi-database architecture for scalability and security.

## ✨ Features

- **Real-time Communication**: WebSocket-based messaging using Socket.io
- **Multi-Database Architecture**: Separate databases for auth, DMs, registry, and per-server data
- **Dynamic Database Creation**: Automatic creation of isolated databases for each server ✨ NEW
- **Channel System**: Create and manage text/voice channels with categories
- **Private Messaging**: Account-to-account direct messaging system
- **Server Registry**: Centralized server management with invite codes
- **Authentication**: Secure JWT-based authentication with server password protection
- **Self-Hosted**: Full control over your data and infrastructure
- **Docker Ready**: Simple deployment with Docker Compose
- **Comprehensive Logging**: Winston logger with file rotation and multiple log levels
- **Production Ready**: Health checks, rate limiting, and security middleware

## 🏗️ Architecture

- **Backend**: Node.js 20 with TypeScript
- **Real-time**: Socket.io for WebSocket communication  
- **API**: Express.js REST API
- **Database**: PostgreSQL 16 (4 separate databases)
  - `auth_db`: Users, profiles, sessions
  - `dm_db`: DM conversations and messages
  - `registry_db`: Server registry and members
  - `server_X_db`: Per-server channels, messages, roles (dynamic)
- **Logging**: Winston with daily log rotation
- **Containerization**: Docker & Docker Compose
- **Frontend**: React 18 + TypeScript + Vite + Zustand

## 📋 Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for client development)
- Git

## 🚀 Quick Start with Docker

### 1. Clone the repository

```bash
git clone https://github.com/HayatoFox/ohkay-server.git
cd ohkay-server
```

### 2. Configure environment variables

Edit `.env` and set your secure values:

```env
# Application
NODE_ENV=production
PORT=8100

# Auth Database
AUTH_DB_HOST=auth-db
AUTH_DB_PORT=5432
AUTH_DB_NAME=ohkay_auth

# DM Database
DM_DB_HOST=dm-db
DM_DB_PORT=5432
DM_DB_NAME=ohkay_dms

# Registry Database
REGISTRY_DB_HOST=registry-db
REGISTRY_DB_PORT=5432
REGISTRY_DB_NAME=ohkay_server_registry

# Database Credentials (shared)
DB_USER=ohkay_user
DB_PASSWORD=CHANGE_ME_SECURE_PASSWORD

# Security
JWT_SECRET=CHANGE_ME_32_CHARS_MINIMUM_JWT_SECRET
SERVER_PASSWORD=CHANGE_ME_SERVER_ACCESS_PASSWORD
DB_ENCRYPTION_KEY=CHANGE_ME_32_CHARS_ENCRYPTION_KEY

# Other
CORS_ORIGIN=*
LOG_LEVEL=info
```

⚠️ **Important**: Change all `CHANGE_ME` values before deploying!

### 3. Start the services

```bash
docker-compose up -d
```

This will:
- Start 4 PostgreSQL databases (auth, dm, registry, server-1)
- Start the Ohkay backend server on port **8100**
- Initialize database schemas automatically
- Create log volumes for persistence

### 4. Verify the deployment

Check that the server is running:

```bash
curl http://localhost:8100/health
```

You should see: `{"status":"ok"}`

### 5. Start the frontend (development)

```bash
cd client
npm install
npm run dev
```

Frontend will be available at: **http://localhost:8101**

## 🌐 Ports Configuration

- **8100**: Backend API + Socket.io
- **8101**: Frontend Vite dev server (development only)
- **5432**: PostgreSQL (internal Docker network only)

All ports are below 8191 for firewall compatibility.

## 🔥 Firewall Setup (AlmaLinux/RHEL)

Two scripts are provided for firewall configuration:

### Standard Setup
```bash
chmod +x firewall-setup.sh
sudo ./firewall-setup.sh
```

### Strict Setup (Maximum Security)
```bash
chmod +x firewall-strict.sh
sudo ./firewall-strict.sh
```

See `PORTS_AND_FIREWALL.txt` for detailed firewall rules.

## � Production Deployment with systemd (Optional)

For automatic startup on server reboot, you can install a systemd service:

### Install the systemd service

```bash
chmod +x install-systemd.sh
sudo ./install-systemd.sh
```

This will:
- Copy `ohkay-server.service` to `/etc/systemd/system/`
- Configure the service to auto-start on boot
- Wait for Docker to be ready before starting
- Implement graceful shutdown (max 20s timeout)

### Manage the service

```bash
# Start the server
sudo systemctl start ohkay-server

# Stop the server
sudo systemctl stop ohkay-server

# Restart the server
sudo systemctl restart ohkay-server

# View status
sudo systemctl status ohkay-server

# View logs
sudo journalctl -u ohkay-server -f

# Disable auto-start
sudo systemctl disable ohkay-server

# Enable auto-start
sudo systemctl enable ohkay-server
```

### Service Features

- **Automatic healthcheck**: Waits for containers to be healthy before completing startup
- **Fast shutdown**: Graceful shutdown with 20s timeout (instead of 140s default)
- **Auto-restart**: Restarts on failure after 10s delay
- **Proper dependencies**: Waits for Docker and network before starting
- **Logs**: All output redirected to systemd journal

## �🛠️ Local Development

### Backend Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
npm start
```

### Frontend Development

```bash
cd client
npm install
npm run dev
```

Frontend proxy is configured to forward `/api` requests to `http://localhost:8100`.

## 🔌 API Endpoints

### Authentication

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "john_doe",
  "displayName": "John Doe",
  "serverPassword": "your_server_password"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "john_doe",
  "serverPassword": "your_server_password"
}
```

### Servers

#### Create Server
```http
POST /api/servers
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "name": "My Server",
  "description": "A cool server",
  "isPublic": true
}
```

#### Get My Servers
```http
GET /api/servers
Authorization: Bearer <jwt_token>
```

#### Create Invite
```http
POST /api/servers/:serverId/invites
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "maxUses": 0,
  "expiresInHours": 168
}
```

#### Join Server
```http
POST /api/servers/join/:inviteCode
Authorization: Bearer <jwt_token>
```

### Channels

#### Get Server Channels
```http
GET /api/servers/:serverId/channels
Authorization: Bearer <jwt_token>
```

#### Create Channel
```http
POST /api/servers/:serverId/channels
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "name": "general",
  "type": "text",
  "description": "General chat"
}
```

### Direct Messages

#### Get Conversations
```http
GET /api/dms
Authorization: Bearer <jwt_token>
```

#### Get DM Messages
```http
GET /api/dms/:conversationId/messages
Authorization: Bearer <jwt_token>
```

#### Send DM
```http
POST /api/dms/:conversationId/messages
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "content": "Hello!"
}
```

## 🔌 WebSocket Events

### Connection
Socket.io connects on the same port as the API (8100) with JWT authentication.

```javascript
const socket = io('http://localhost:8100', {
  auth: { token: 'your_jwt_token' }
});
```

### Client → Server

- `join_server` - Join a server room
  ```javascript
  socket.emit('join_server', { serverId });
  ```

- `leave_server` - Leave a server room
  ```javascript
  socket.emit('leave_server', { serverId });
  ```

- `join_conversation` - Join a DM conversation
  ```javascript
  socket.emit('join_conversation', { conversationId });
  ```

- `send_message` - Send channel message
  ```javascript
  socket.emit('send_message', { serverId, channelId, content });
  ```

- `send_private_message` - Send DM
  ```javascript
  socket.emit('send_private_message', { conversationId, content });
  ```

- `typing` - Indicate typing
  ```javascript
  socket.emit('typing', { serverId, channelId });
  ```

- `status_change` - Update user status
  ```javascript
  socket.emit('status_change', { status: 'online' });
  ```

### Server → Client

- `authenticated` - Connection authenticated
- `new_message` - New channel message
- `new_private_message` - New DM received
- `message_deleted` - Message deleted
- `message_edited` - Message edited
- `user_typing` - User is typing
- `user_status_change` - User status changed
- `server_updated` - Server info updated
- `channel_created` - New channel created
- `member_joined` - Member joined server
- `member_left` - Member left server

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
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# View logs (follow mode)
docker-compose logs -f

# View specific service logs
docker-compose logs -f app
docker-compose logs -f auth-db

# Restart services
docker-compose restart

# Rebuild and restart
docker-compose down
docker-compose up -d --build

# Remove volumes (⚠️ deletes data)
docker-compose down -v
```

## 🔧 Troubleshooting

### Database connection issues

Check PostgreSQL containers are running:
```bash
docker-compose ps
```

View PostgreSQL logs:
```bash
docker-compose logs auth-db
docker-compose logs dm-db
docker-compose logs registry-db
```

### Application won't start

1. Check the logs:
   ```bash
   docker-compose logs app
   ```

2. Verify environment variables are set correctly in `.env`

3. Ensure all PostgreSQL containers are healthy:
   ```bash
   docker-compose ps
   ```

### Port already in use

Change port mapping in `docker-compose.yml` and `.env`:
```yaml
ports:
  - "8200:8100"  # External:Internal
```

And update `.env`:
```env
PORT=8100
```

### WebSocket not connecting

1. Check CORS origin in `.env`:
   ```env
   CORS_ORIGIN=http://localhost:8101
   ```

2. Verify Socket.io connection in browser console

3. Check firewall allows port 8100

## 🔒 Security Considerations

1. **Change default passwords**: All passwords in `.env` must be changed
2. **Use strong secrets**: JWT_SECRET and DB_ENCRYPTION_KEY must be 32+ characters
3. **HTTPS in production**: Use reverse proxy (Nginx/Caddy) with SSL/TLS on ports 80/443
4. **Firewall**: Use provided firewall scripts for AlmaLinux/RHEL
5. **Limit CORS**: Set `CORS_ORIGIN` to your frontend domain
6. **SSH security**: Limit SSH access by IP, use SSH keys
7. **Regular updates**: Keep dependencies and Docker images updated
8. **Backup databases**: Regularly backup PostgreSQL volumes
9. **Rate limiting**: Configured in firewall scripts (100 req/min on port 8100)
10. **DB encryption**: Database passwords are encrypted with AES-256-CBC

## 📁 Project Structure

```
ohkay-server/
├── src/                          # Backend source
│   ├── index.ts                  # Main application entry + Socket.io
│   ├── routes/
│   │   ├── auth.ts              # Authentication (register, login)
│   │   ├── channels.ts          # Channel management (multi-DB)
│   │   ├── dms.ts               # Direct messages
│   │   └── servers.ts           # Server CRUD + members + invites
│   ├── socket/
│   │   └── handlers.ts          # WebSocket event handlers
│   └── utils/
│       ├── auth.ts              # JWT middleware + AuthRequest
│       ├── database.ts          # Multi-DB manager + encryption
│       └── logger.ts            # Winston logger
│
├── client/                       # Frontend React app
│   ├── src/
│   │   ├── api/                 # API layer (Axios)
│   │   ├── components/          # React components
│   │   ├── services/            # WebSocket service
│   │   └── store/               # Zustand state management
│   ├── vite.config.ts           # Vite config with proxy
│   └── package.json
│
├── init-scripts/                 # Database initialization
│   ├── auth.sql                 # Auth DB schema
│   ├── dms.sql                  # DM DB schema
│   ├── registry.sql             # Registry DB schema
│   └── server_template.sql      # Server DB template
│
├── logs/                         # Application logs
├── docker-compose.yml            # Docker orchestration (4 DBs + app)
├── Dockerfile                    # Backend container
├── .env                          # Environment variables
├── firewall-setup.sh             # Standard firewall config
├── firewall-strict.sh            # Strict firewall config
├── PORTS_AND_FIREWALL.txt        # Port documentation
├── PROJECT_STATE.txt             # Development state
└── CLIENT_API_SPECS.txt          # API specifications
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

MIT License - See LICENSE file for details

## 🔮 Roadmap

- [x] Multi-database architecture
- [x] Real-time messaging (Socket.io)
- [x] Direct messages (account-to-account)
- [x] Server system with invites
- [x] Channel categories (text/voice/announcement)
- [x] React frontend with Zustand
- [x] WebSocket integration in client
- [ ] Voice channels implementation
- [ ] File uploads and sharing
- [ ] User roles and permissions per server
- [ ] Markdown support in messages
- [ ] Message editing/deletion in UI
- [ ] Typing indicators in UI
- [ ] Desktop notifications
- [ ] Mobile responsive design
- [ ] End-to-end encryption for DMs
- [ ] Desktop app (Electron)
- [ ] Mobile apps (React Native)

## 💬 Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

Made with ❤️ for the self-hosting community
