// Test SSE parsing - mimics what the frontend does
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  console.log('=== RAW RESPONSE (escaped) ===');
  console.log(JSON.stringify(data));
  console.log('');
  console.log('=== LINE BY LINE ===');
  const lines = data.split('\n');
  let currentEvent = null;
  let tokenContent = '';
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.substring(7).trim();
      console.log('EVENT:', currentEvent);
    } else if (line.startsWith('data: ')) {
      try {
        const jsonStr = line.substring(6).trim();
        const parsed = JSON.parse(jsonStr);
        if (currentEvent === 'token' && parsed.text) {
          tokenContent += parsed.text;
          console.log('TOKEN:', parsed.text.substring(0, 80));
        } else {
          console.log(currentEvent + ':', JSON.stringify(parsed).substring(0, 100));
        }
      } catch(e) {
        console.log('PARSE ERROR on line:', JSON.stringify(line));
      }
    } else if (line.startsWith('id: ')) {
      console.log('ID:', line);
    } else if (line.trim() === '') {
      console.log('(empty line - reset event)');
      currentEvent = null;
    } else {
      console.log('UNKNOWN:', JSON.stringify(line));
    }
  }
  console.log('');
  console.log('=== FINAL TOKEN CONTENT ===');
  console.log(tokenContent || '(empty)');
  console.log('Length:', tokenContent.length);
});
