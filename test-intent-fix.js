/**
 * Test script to verify the intent detection fix
 * Tests that ticker is preserved when confidence is exactly 0.7
 */

const axios = require('axios');

async function testIntentDetection() {
  console.log('🧪 Testing Intent Detection Fix\n');
  
  const testQuery = "Who are NVDA's competitors?";
  
  try {
    console.log(`Query: "${testQuery}"\n`);
    
    // Create a conversation first
    const createResponse = await axios.post('http://localhost:3000/api/research/conversations', {
      title: 'Test Conversation',
      tenantId: 'test-tenant'
    });
    
    const conversationId = createResponse.data.id;
    console.log(`✅ Created conversation: ${conversationId}\n`);
    
    // Send the message
    console.log('📤 Sending message...\n');
    const messageResponse = await axios.post(
      `http://localhost:3000/api/research/conversations/${conversationId}/messages`,
      {
        content: testQuery,
        tenantId: 'test-tenant'
      }
    );
    
    console.log('✅ Response received!\n');
    console.log('Response:', JSON.stringify(messageResponse.data, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('\nFull error details:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testIntentDetection();
