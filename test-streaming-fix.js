/**
 * Test script to verify streaming fix is working
 * Run with: node test-streaming-fix.js
 */

const text = `# GOOGL Analysis

Google's business model is based on advertising. Here are key points:

- Search dominance
- YouTube platform
- Cloud services

The company reported **strong revenue growth** in Q4 2023.`;

// Simulate the splitIntoSentences method
function splitIntoSentences(text) {
  const chunks = [];
  let currentChunk = '';
  let inCodeBlock = false;
  let inList = false;

  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect code blocks
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      currentChunk += line + '\n';
      continue;
    }

    // If in code block, don't split
    if (inCodeBlock) {
      currentChunk += line + '\n';
      continue;
    }

    // Detect lists
    if (line.trim().match(/^[-*+]\s/) || line.trim().match(/^\d+\.\s/)) {
      inList = true;
      currentChunk += line + '\n';
      continue;
    }

    // If in list and line is empty, end list
    if (inList && line.trim() === '') {
      inList = false;
      if (currentChunk.trim()) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      continue;
    }

    // If in list, continue adding
    if (inList) {
      currentChunk += line + '\n';
      continue;
    }

    // Regular text - split by sentences
    if (line.trim()) {
      // Split by sentence boundaries (. ! ?)
      const sentences = line.split(/([.!?]+\s+)/);
      for (const sentence of sentences) {
        if (sentence.trim()) {
          currentChunk += sentence;
          // If sentence ends with punctuation, yield chunk
          if (sentence.match(/[.!?]+\s*$/)) {
            if (currentChunk.trim()) {
              chunks.push(currentChunk);
              currentChunk = '';
            }
          }
        }
      }
    } else {
      // Empty line - yield current chunk and add newline
      if (currentChunk.trim()) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      chunks.push('\n');
    }
  }

  // Add remaining chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk);
  }

  return chunks.filter(c => c.trim() || c === '\n');
}

console.log('Testing splitIntoSentences...\n');
console.log('Input text:');
console.log('---');
console.log(text);
console.log('---\n');

const chunks = splitIntoSentences(text);

console.log(`Split into ${chunks.length} chunks:\n`);
chunks.forEach((chunk, i) => {
  console.log(`Chunk ${i + 1}:`);
  console.log(JSON.stringify(chunk));
  console.log('');
});

console.log('Reconstructed text:');
console.log('---');
console.log(chunks.join(''));
console.log('---\n');

console.log('Match original?', chunks.join('') === text);
