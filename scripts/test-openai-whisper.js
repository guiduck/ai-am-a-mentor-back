const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

async function testOpenAIWhisper() {
  try {
    console.log('🎤 Testing OpenAI Whisper integration...');
    
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not found in environment variables');
    }
    
    console.log('✅ OpenAI API key found');
    console.log('Key prefix:', process.env.OPENAI_API_KEY.substring(0, 8) + '...');
    
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // Create a simple test audio file (we'll just test the API setup)
    console.log('🔍 Testing OpenAI API connection...');
    
    // Test with a simple API call first
    const models = await openai.models.list();
    const whisperModels = models.data.filter(model => model.id.includes('whisper'));
    
    console.log('✅ OpenAI API connection successful!');
    console.log('Available Whisper models:', whisperModels.map(m => m.id));
    
    // Note: For a real test, you'd need an actual audio file
    console.log('💡 To test transcription, upload an audio file and use the /videos/transcribe endpoint');
    
  } catch (error) {
    console.error('❌ OpenAI Whisper test failed:', error.message);
    if (error.status === 401) {
      console.error('💡 Check your OPENAI_API_KEY - it may be invalid');
    }
    process.exit(1);
  }
}

testOpenAIWhisper();
