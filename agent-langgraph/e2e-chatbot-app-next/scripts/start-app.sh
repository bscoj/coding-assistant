#!/bin/bash
set -e

echo "==================================================================="
echo "Starting Databricks Chatbot App"
echo "==================================================================="

export CHAT_APP_SERVER_PORT="${CHAT_APP_SERVER_PORT:-3001}"
export CHAT_APP_CLIENT_PORT="${CHAT_APP_CLIENT_PORT:-3002}"
export CHAT_APP_CORS_ORIGIN="${CHAT_APP_CORS_ORIGIN:-http://localhost:${CHAT_APP_CLIENT_PORT}}"

# Install dependencies
echo "Installing dependencies..."
npm install

# Start app
echo "Starting app (npm run dev)..."
echo
echo "-------------------------------------------------------------------"
echo "App URLs:"
echo "  Frontend: http://localhost:${CHAT_APP_CLIENT_PORT}  <-- Open this in your browser"
echo "  Backend:  http://localhost:${CHAT_APP_SERVER_PORT}"
echo "-------------------------------------------------------------------"
echo
npm run dev
