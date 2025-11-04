#!/bin/bash

# Environment switcher script for API
# Usage: ./switch-env.sh [local|staging|production]

if [ $# -eq 0 ]; then
    echo "Usage: $0 [local|staging|production]"
    echo "Current environment files:"
    ls -la .env*
    exit 1
fi

ENV=$1

case $ENV in
    local)
        echo "Switching to LOCAL environment..."
        cp .env.local .env
        echo "✅ Using local Docker PostgreSQL and local settings"
        ;;
    staging)
        echo "Switching to STAGING environment..."
        cp .env.staging .env
        echo "✅ Using staging environment settings"
        ;;
    production)
        echo "Switching to PRODUCTION environment..."
        # For production, we'd typically use different approach
        # but for now, just copy if exists
        if [ -f .env.production ]; then
            cp .env.production .env
            echo "✅ Using production environment settings"
        else
            echo "❌ .env.production file not found"
            exit 1
        fi
        ;;
    *)
        echo "❌ Invalid environment: $ENV"
        echo "Valid options: local, staging, production"
        exit 1
        ;;
esac

echo ""
echo "Current .env contents:"
echo "========================"
# Show .env but hide sensitive values
sed 's/=.*/=***/' .env
echo "========================"
echo ""
echo "✅ Environment switched to: $ENV"
