// mnpt - The Script
// Implements the "Decay/Bloom" effect and the Playground logic.

document.addEventListener('DOMContentLoaded', () => {
    console.log('mnpt active.');

    // 1. Initialize the Playground
    const inputArea = document.getElementById('playground-input');
    const outputArea = document.getElementById('playground-output');

    if (inputArea && outputArea) {
        inputArea.addEventListener('input', (e) => {
            const text = e.target.value;
            const compressed = compressText(text);
            outputArea.textContent = compressed;
        });
    }

    // 2. Initialize the Decay/Bloom Effect for Content Blocks
    const blocks = document.querySelectorAll('.mnpt-block');
    
    blocks.forEach(block => {
        const fullText = block.textContent.trim();
        const compressed = compressText(fullText);
        
        // Create the structure:
        // <div class="mnpt-block">
        //   <span class="full-text">...</span>
        //   <span class="compressed-text">...</span>
        // </div>
        
        block.innerHTML = ''; // Clear original text
        
        const fullSpan = document.createElement('span');
        fullSpan.className = 'full-text';
        fullSpan.textContent = fullText;
        
        const compSpan = document.createElement('span');
        compSpan.className = 'compressed-text';
        compSpan.textContent = compressed;
        compSpan.style.display = 'none'; // Start hidden
        
        block.appendChild(fullSpan);
        block.appendChild(compSpan);
        
        // Add hover listeners
        block.addEventListener('mouseenter', () => {
            fullSpan.style.display = 'inline';
            compSpan.style.display = 'none';
        });
        
        block.addEventListener('mouseleave', () => {
            // Only compress if scrolled past a certain point? 
            // For now, let's make it behave like "Decay on idle/leave"
            fullSpan.style.display = 'none';
            compSpan.style.display = 'inline';
        });
        
        // Initial state: Show full text (Bloom)
        // Let's invert it: Show compressed by default to be mysterious?
        // No, show full text, decay on scroll.
        
        // Observer for scroll decay
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) {
                    // Reset to full text when out of view?
                    // Or maybe decay when IT IS in view but user is scrolling fast?
                    // Let's keep it simple: Decay on leave.
                } else {
                    // When in view, default to compressed after a delay?
                    setTimeout(() => {
                        if (!block.matches(':hover')) {
                            fullSpan.style.display = 'none';
                            compSpan.style.display = 'inline';
                        }
                    }, 2000); // 2 seconds of reading time, then decay
                }
            });
        }, { threshold: 0.5 });
        
        observer.observe(block);
    });
});

// --- The Compression Engine (Simple JS Implementation) ---

function compressText(text) {
    if (!text) return '';
    
    // Dictionary of common mappings (The "Dialect")
    const dictionary = {
        'check': 'chk',
        'update': 'updt',
        'generate': 'gen',
        'search': 'srch',
        'delete': 'del',
        'create': 'crt',
        'project': 'prj',
        'system': 'sys',
        'config': 'cfg',
        'function': 'fn',
        'return': 'ret',
        'import': 'imp',
        'export': 'exp',
        'default': 'def',
        'please': '', // Politeness is noise
        'could': '',
        'would': '',
        'should': '',
        'the': '',
        'a': '',
        'an': '',
        'is': '=',
        'are': '=',
        'to': '->',
        'for': '4',
        'with': 'w/',
        'without': 'w/o',
        'because': 'bc',
        'before': 'b4',
        'intent-driven': 'IDS',
        'sparsity': 'sprs',
        'context': 'ctx',
        'input': 'inp',
        'output': 'out',
        'resolution': 'res',
        'proportional': '~',
        'inversely': '1/',
        'handshake': 'hndshk',
        'latent': 'lat',
        'minimal': 'min',
        'maximum': 'max',
        'interface': 'iface',
        'neural': 'neu',
        'agent': 'agnt',
        'user': 'usr',
        'model': 'mdl',
        'probability': 'prob',
        'hallucination': 'halluc',
        'ambiguity': 'ambig'
    };

    // Split by words, keeping punctuation
    const tokens = text.split(/(\s+|[.,;?!])/);
    
    return tokens.map(token => {
        const lower = token.toLowerCase().trim();
        
        // 1. Check Dictionary
        if (dictionary.hasOwnProperty(lower)) {
            return dictionary[lower];
        }
        
        // 2. Skip whitespace/punctuation for processing, but return them
        if (!token.match(/[a-zA-Z0-9]/)) {
            return token; // Return punctuation as is
        }
        
        // 3. Vowel Stripping (if longer than 3 chars)
        if (lower.length > 3) {
            // Keep first letter, remove vowels from rest
            const first = token[0];
            const rest = token.slice(1).replace(/[aeiou]/gi, '');
            return first + rest;
        }
        
        return token;
    }).join(''); // Rejoin without adding extra spaces (tokens include spaces)
}
