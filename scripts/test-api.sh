#!/bin/bash

# Test API endpoints script
# Tests all major API routes

BASE_URL="http://localhost:3001/api"
TOKEN=""

echo "🚀 Testing API endpoints..."
echo "Base URL: $BASE_URL"
echo ""

# Test 1: Health check (if exists)
echo "1. Testing server health..."
curl -s "$BASE_URL/health" || echo "No health endpoint"
echo ""

# Test 2: Creator registration
echo "2. Testing creator registration..."
CREATOR_RESPONSE=$(curl -s -X POST "$BASE_URL/creators/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testcreator",
    "email": "creator@test.com",
    "password": "Test123456"
  }')

echo "Creator registration response:"
echo "$CREATOR_RESPONSE"
echo ""

# Test 3: Creator login
echo "3. Testing creator login..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/creators/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "creator@test.com",
    "password": "Test123456"
  }')

echo "Creator login response:"
echo "$LOGIN_RESPONSE"

# Extract token (assuming JSON response with token field)
TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "Extracted token: ${TOKEN:0:20}..." # Show first 20 chars
echo ""

# Test 4: Student registration
echo "4. Testing student registration..."
STUDENT_RESPONSE=$(curl -s -X POST "$BASE_URL/students/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "teststudent",
    "email": "student@test.com",
    "password": "Test123456"
  }')

echo "Student registration response:"
echo "$STUDENT_RESPONSE"
echo ""

# Test 5: Get courses (with auth if token exists)
echo "5. Testing get courses..."
if [ -n "$TOKEN" ]; then
  COURSES_RESPONSE=$(curl -s "$BASE_URL/creators/courses" \
    -H "Authorization: Bearer $TOKEN")
else
  COURSES_RESPONSE=$(curl -s "$BASE_URL/creators/courses")
fi

echo "Courses response:"
echo "$COURSES_RESPONSE"
echo ""

# Test 6: Video upload URL (with auth)
echo "6. Testing video upload URL..."
if [ -n "$TOKEN" ]; then
  VIDEO_RESPONSE=$(curl -s -X POST "$BASE_URL/videos/upload-url" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "filename": "test-video.mp4",
      "contentType": "video/mp4"
    }')
  
  echo "Video upload URL response:"
  echo "$VIDEO_RESPONSE"
else
  echo "⚠️  Skipping video upload test - no auth token"
fi
echo ""

echo "✅ API testing complete!"
