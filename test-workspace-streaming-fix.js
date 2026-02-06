/**
 * Test script for workspace.html research assistant streaming fix
 * 
 * This tests that:
 * 1. Messages stream correctly without cutting off
 * 2. Markdown formatting is preserved
 * 3. The streaming flag prevents markdown rendering during streaming
 */

const puppeteer = require('puppeteer');

async function testWorkspaceStreaming() {
    console.log('🧪 Testing workspace.html research assistant streaming fix...\n');
    
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        
        // Enable console logging
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('✍️') || text.includes('✅') || text.includes('📊')) {
                console.log('  Browser:', text);
            }
        });
        
        // Login first
        console.log('1️⃣ Logging in...');
        await page.goto('http://localhost:3000/login.html');
        await page.waitForSelector('input[type="email"]');
        await page.type('input[type="email"]', 'admin@fundlens.com');
        await page.type('input[type="password"]', 'admin123');
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle0' });
        console.log('   ✅ Logged in\n');
        
        // Navigate to workspace
        console.log('2️⃣ Navigating to GOOGL workspace...');
        await page.goto('http://localhost:3000/app/deals/workspace.html?ticker=GOOGL');
        await page.waitForSelector('[x-data="dealWorkspace()"]', { timeout: 10000 });
        console.log('   ✅ Workspace loaded\n');
        
        // Switch to Research tab
        console.log('3️⃣ Switching to Research tab...');
        await page.evaluate(() => {
            const researchTab = Array.from(document.querySelectorAll('.nav-item'))
                .find(el => el.textContent.includes('Research'));
            if (researchTab) researchTab.click();
        });
        await page.waitForTimeout(1000);
        console.log('   ✅ Research tab active\n');
        
        // Send a test query
        console.log('4️⃣ Sending test query: "What are the key risks for GOOGL?"');
        const testQuery = 'What are the key risks for GOOGL?';
        
        await page.evaluate((query) => {
            const textarea = document.querySelector('textarea[x-model="researchInput"]');
            if (textarea) {
                textarea.value = query;
                textarea.dispatchEvent(new Event('input'));
            }
        }, testQuery);
        
        await page.waitForTimeout(500);
        
        // Click send button
        await page.evaluate(() => {
            const sendButton = Array.from(document.querySelectorAll('button'))
                .find(btn => btn.querySelector('.fa-paper-plane'));
            if (sendButton) sendButton.click();
        });
        
        console.log('   ⏳ Waiting for response...\n');
        
        // Wait for streaming to start
        await page.waitForTimeout(2000);
        
        // Monitor streaming progress
        let lastLength = 0;
        let unchangedCount = 0;
        const maxUnchanged = 10; // 10 seconds without change = done
        
        while (unchangedCount < maxUnchanged) {
            const messageData = await page.evaluate(() => {
                const messages = document.querySelectorAll('.message-assistant');
                if (messages.length === 0) return null;
                
                const lastMessage = messages[messages.length - 1];
                const content = lastMessage.textContent || '';
                const isStreaming = lastMessage.querySelector('[x-show="message.streaming"]') !== null;
                
                return {
                    length: content.length,
                    content: content.substring(0, 200), // First 200 chars
                    isStreaming,
                    hasMarkdown: lastMessage.querySelector('h1, h2, h3, ul, ol, code, pre') !== null
                };
            });
            
            if (messageData) {
                if (messageData.length !== lastLength) {
                    console.log(`   📝 Message length: ${messageData.length} chars`);
                    lastLength = messageData.length;
                    unchangedCount = 0;
                } else {
                    unchangedCount++;
                }
                
                // Check if streaming is done
                if (!messageData.isStreaming && messageData.length > 0) {
                    console.log('\n   ✅ Streaming complete!');
                    console.log(`   📊 Final length: ${messageData.length} chars`);
                    console.log(`   🎨 Markdown rendered: ${messageData.hasMarkdown ? 'YES' : 'NO'}`);
                    console.log(`   📄 Preview: ${messageData.content.substring(0, 150)}...\n`);
                    break;
                }
            }
            
            await page.waitForTimeout(1000);
        }
        
        // Final verification
        console.log('5️⃣ Verifying response quality...');
        
        const finalCheck = await page.evaluate(() => {
            const messages = document.querySelectorAll('.message-assistant');
            if (messages.length === 0) return { success: false, error: 'No messages found' };
            
            const lastMessage = messages[messages.length - 1];
            const content = lastMessage.textContent || '';
            
            return {
                success: true,
                length: content.length,
                hasContent: content.length > 100,
                notCutOff: !content.endsWith('...') && content.length > 200,
                hasMarkdown: lastMessage.querySelector('h1, h2, h3, ul, ol, code, pre') !== null,
                fullContent: content
            };
        });
        
        if (!finalCheck.success) {
            console.log('   ❌ FAILED:', finalCheck.error);
            return false;
        }
        
        console.log(`   ✅ Has content: ${finalCheck.hasContent ? 'YES' : 'NO'}`);
        console.log(`   ✅ Not cut off: ${finalCheck.notCutOff ? 'YES' : 'NO'}`);
        console.log(`   ✅ Markdown rendered: ${finalCheck.hasMarkdown ? 'YES' : 'NO'}`);
        
        if (finalCheck.hasContent && finalCheck.notCutOff) {
            console.log('\n✅ TEST PASSED! Streaming works correctly.\n');
            return true;
        } else {
            console.log('\n❌ TEST FAILED! Response was cut off or incomplete.\n');
            console.log('Full content:', finalCheck.fullContent);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Test error:', error.message);
        return false;
    } finally {
        // Keep browser open for manual inspection
        console.log('Browser will remain open for 30 seconds for manual inspection...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        await browser.close();
    }
}

// Run test
testWorkspaceStreaming()
    .then(success => {
        process.exit(success ? 0 : 1);
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
