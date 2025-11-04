#!/bin/bash

# Deploy script for Render
# This script handles the monorepo structure properly

echo "🚀 Starting deployment process..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install drizzle-kit globally to ensure it's available
echo "🔧 Installing drizzle-kit globally..."
npm install -g drizzle-kit

# Run database migrations
echo "🗄️ Running database migrations..."
npx drizzle-kit migrate

echo "✅ Deployment process completed!"
