# Ohkay Server - Copilot Instructions

## Project Overview
Ohkay-server is a self-hosted Discord alternative built with Node.js, TypeScript, Socket.io, and PostgreSQL. Focus on Docker deployment simplicity and comprehensive logging.

## Tech Stack
- **Runtime**: Node.js with TypeScript
- **Real-time**: Socket.io for WebSocket communication
- **API**: Express.js REST API
- **Database**: PostgreSQL
- **Logging**: Winston with file rotation
- **Containerization**: Docker & Docker Compose

## Development Guidelines
- Use TypeScript strict mode
- Implement comprehensive error handling with detailed logging
- Follow async/await patterns
- Use environment variables for all configuration
- Log all important events with appropriate levels (error, warn, info, debug)

## Docker Deployment Priority
- Keep Docker setup simple and production-ready
- Use docker-compose for orchestration
- Mount log volumes for persistence
- Include health checks
- Use multi-stage builds for optimization

## Logging Requirements
- Winston logger with multiple transports (console, file, error file)
- Structured logging with timestamps and context
- Separate error logs from general logs
- Log rotation to prevent disk fill
- Include request/response logging for debugging
