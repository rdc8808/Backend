#!/bin/bash
# Deploy script for Render - runs migrations before starting server

echo "🔄 Running database migrations..."
node migrate-soft-delete.js

echo "🚀 Starting server..."
node server.js
